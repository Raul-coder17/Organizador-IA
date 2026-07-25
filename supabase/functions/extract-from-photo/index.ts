// Edge Function: extract-from-photo
//
// Captura de item por foto (PLAN_REDISEÑO.md ítem 14). Recibe UNA imagen,
// se la pasa a Gemini y devuelve UNA acción propuesta `create` con la misma
// forma que emite `proposeCreateItem` del asistente, para que el frontend
// reuse tal cual la tarjeta de preview con Confirmar/Cancelar.
//
// Mismo patrón de seguridad que `ai-assistant`:
// - Requiere JWT de usuario válido + ai_enabled = true con key guardada.
// - La key se descifra acá, nunca se persiste ni se devuelve al cliente.
// - NADA se escribe: la función sólo propone. El item lo crea el frontend por
//   `repo.ts` (offline-first) recién cuando el usuario confirma.
//
// LA IMAGEN NO SE GUARDA EN NINGÚN LADO. No pasa por Supabase Storage, no queda
// en la base ni en un log: se recibe en memoria, se reenvía a Gemini y se
// descarta al terminar el request. Es lo que hace que "captura por foto" no
// agregue una superficie de datos nueva — lo que se persiste es el item que el
// usuario confirmó, igual que si lo hubiera escrito a mano.
//
// La foto consume la MISMA cuota diaria de Gemini que el asistente (una llamada
// = un request contra `ai_usage`), así que comparte el pre-flight de cuota
// aprendida, el manejo adaptativo del 429 y los mensajes en español.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { RESPONSE_SCHEMA, buildPrompt, normalizarExtraccion, parseJsonLaxo } from './extract.ts'
import { decideRpmSlot } from './rpm.ts'

// Nativamente multimodal (texto + imagen en el mismo `contents`), así que NO
// hace falta un modelo aparte para visión: es el mismo que ya usa
// `ai-assistant`, con una `inlineData` extra en las parts. Mantenerlo idéntico
// importa: una sola cuota, un solo modelo que actualizar el día que Google
// retire este (ya pasó con gemini-2.0-flash y con gemini-2.5-flash).
//
// gemini-3.1-flash-lite (no "-preview": esa variante quedó dada de baja).
// Confirmado contra la doc oficial que soporta function calling e imagen como
// input — acá no se usa function calling, pero si sigue habiendo `responseMimeType
// + responseSchema` (salida estructurada) es lo que importa, y también está
// confirmado. Mismo cuidado que en ai-assistant con el thinking: acá usa
// `thinkingLevel`, no `thinkingBudget` (ver generationConfig más abajo).
const GEMINI_MODEL = 'gemini-3.1-flash-lite'
// RPM real de este modelo para este proyecto (AI Studio). Se comparte con
// ai-assistant porque es el mismo modelo/cuenta — de ahí que la tabla
// ai_call_log (ver rpm.ts) no distinga de qué función vino cada llamada.
const GEMINI_RPM = 15
const RPM_WINDOW_MS = 60_000

// Tope de la imagen ya codificada en base64. El frontend achica y recomprime
// antes de mandar (ver src/lib/fotoItem.ts), así que en la práctica llega muy
// por debajo; esto es la red de contención para una llamada armada a mano o un
// navegador donde el redimensionado no corrió.
const MAX_BASE64_BYTES = 5 * 1024 * 1024

const MIMES_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

// Tope de los textos libres que escribe el usuario (el comentario previo y la
// corrección posterior). Con 2000 caracteres entra cualquier aclaración real y
// no hay forma de que un pegado accidental se coma el presupuesto de tokens de
// la transcripción.
const MAX_TEXTO_USUARIO = 2000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function decryptApiKey(payload: string, secretB64: string): Promise<string> {
  const [ivB64, ctB64] = payload.split('.')
  if (!ivB64 || !ctB64) throw new Error('Formato de key cifrada inválido.')
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0))
  const ciphertext = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0))
  const secretBytes = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('raw', secretBytes, 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext)
  return new TextDecoder().decode(plaintext)
}

// ---------------------------------------------------------------------------
// Gemini: mismo manejo de errores y rate limit que ai-assistant.
// Duplicado a propósito y no importado: las Edge Functions se despliegan una por
// una y compartir un módulo entre dos carpetas de `supabase/functions` ata sus
// deploys. El comportamiento visible (los mensajes en español) es idéntico, que
// es lo que el usuario ve; si un mensaje cambia, hay que cambiarlo en los dos.
// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}
interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] }
  finishReason?: string
}

interface RateLimitInfo {
  kind: 'day' | 'short'
  quotaValue?: number
  retryDelaySeconds?: number
  quotaId?: string
}

class GeminiError extends Error {
  constructor(
    public userMessage: string,
    public rateLimit?: RateLimitInfo,
  ) {
    super(userMessage)
    this.name = 'GeminiError'
  }
}

function parseRateLimit(rawBody: string): RateLimitInfo {
  try {
    const parsed = JSON.parse(rawBody)
    const details = Array.isArray(parsed?.error?.details) ? parsed.error.details : []
    const quotaFailure = details.find((d: Record<string, unknown>) =>
      String(d['@type'] ?? '').includes('QuotaFailure'),
    )
    const retryInfo = details.find((d: Record<string, unknown>) =>
      String(d['@type'] ?? '').includes('RetryInfo'),
    )
    const violation = quotaFailure?.violations?.[0] ?? {}
    const quotaId: string = violation.quotaId ?? ''
    const quotaValue = violation.quotaValue != null ? Number(violation.quotaValue) : undefined

    let retryDelaySeconds: number | undefined
    const rawDelay = retryInfo?.retryDelay
    if (typeof rawDelay === 'string') {
      const m = rawDelay.match(/([\d.]+)s/)
      if (m) retryDelaySeconds = Math.ceil(Number(m[1]))
    }

    const isDay = /perday|daily/i.test(quotaId)
    const isShort = /perminute|persecond/i.test(quotaId)
    const kind: 'day' | 'short' = isDay
      ? 'day'
      : isShort
        ? 'short'
        : retryDelaySeconds != null && retryDelaySeconds <= 120
          ? 'short'
          : 'day'

    return { kind, quotaValue: Number.isFinite(quotaValue) ? quotaValue : undefined, retryDelaySeconds, quotaId }
  } catch {
    return { kind: 'day' }
  }
}

function mensajeCuotaDiaria(n?: number): string {
  const cuota = n != null ? `tus ${n} mensajes` : 'tus mensajes'
  return `Ya usaste ${cuota} de IA de hoy. Volvé mañana (la cuota se reinicia a medianoche, hora del Pacífico de EE.UU.).`
}

function mensajeCuotaCorta(segundos?: number): string {
  if (segundos != null) {
    return `Alcanzaste el límite de mensajes por minuto. Esperá ${segundos} segundos y volvé a intentar.`
  }
  return 'Alcanzaste el límite de mensajes por minuto. Esperá un momento y volvé a intentar.'
}

// Mismo freno proactivo que ai-assistant (ver el comentario largo allá):
// chequea la ventana de RPM ANTES de gastar la llamada, en vez de enterarse
// con un 429 real. Comparten la misma tabla ai_call_log porque comparten
// modelo y cuenta.
function mensajeRpmProactivo(segundos: number): string {
  return `Vas rápido con la IA: llegaste al máximo de ${GEMINI_RPM} mensajes por minuto. Esperá ${segundos} segundo${segundos === 1 ? '' : 's'} y volvé a intentar.`
}

async function reserveRpmSlot(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const nowMs = Date.now()
  const desdeIso = new Date(nowMs - RPM_WINDOW_MS).toISOString()

  await supabase.from('ai_call_log').delete().eq('user_id', userId).lt('called_at', desdeIso)

  const { data } = await supabase
    .from('ai_call_log')
    .select('called_at')
    .eq('user_id', userId)
    .gte('called_at', desdeIso)

  const timestamps = (data ?? []).map((r) => new Date(r.called_at as string).getTime())
  const decision = decideRpmSlot(timestamps, GEMINI_RPM, RPM_WINDOW_MS, nowMs)

  if (decision.allowed) {
    await supabase.from('ai_call_log').insert({ user_id: userId, called_at: new Date(nowMs).toISOString() })
  }

  return decision
}

function translateGeminiError(status: number, rawBody: string): string {
  let apiStatus = ''
  let reason = ''
  try {
    const parsed = JSON.parse(rawBody)
    apiStatus = parsed?.error?.status ?? ''
    const details = Array.isArray(parsed?.error?.details) ? parsed.error.details : []
    reason = details.find((d: { reason?: string }) => d?.reason)?.reason ?? ''
  } catch {
    // body no-JSON: seguimos solo con el status HTTP.
  }

  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
    return 'Se alcanzó el límite de uso de la IA por ahora. Intentá de nuevo en unos minutos, o revisá tu plan de Gemini si esto se repite seguido.'
  }
  if (status === 400 && reason === 'API_KEY_INVALID') {
    return 'Tu API key de Gemini no es válida. Revisá la key en Configuración.'
  }
  if (status === 403 || apiStatus === 'PERMISSION_DENIED') {
    return 'Tu cuenta de Gemini no tiene acceso a este modelo. Revisá tu plan en Google AI Studio.'
  }
  if (status === 500 || status === 503) {
    return 'El servicio de IA está teniendo problemas ahora mismo. Intentá de nuevo en un momento.'
  }
  return `Hubo un problema con la IA (código ${status}). Intentá de nuevo; si se repite, avisá.`
}

// Un solo turno: no hay function-calling acá, la imagen entra y sale una
// propuesta. Sin loop, sin tools.
async function callGeminiVision(
  apiKey: string,
  prompt: string,
  imagenBase64: string,
  mimeType: string,
): Promise<GeminiCandidate> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { inlineData: { mimeType, data: imagenBase64 } }],
          },
        ],
        // Modelo "thinking". Con el nivel por defecto (MINIMAL) puede gastar
        // poco razonamiento antes de emitir parts; pero leer una foto no es lo
        // mismo que contestar un chat: transcribir una tabla larga sin
        // saltearse renglones ni correr una columna es justamente donde el
        // razonamiento ayuda, así que acá se sube un escalón por encima del
        // mínimo (LOW), a diferencia de ai-assistant que se queda en MINIMAL.
        //
        // En la serie 2.5 esto se controlaba con un budget numérico de tokens
        // (2048 de 8192, dejando ~6k para el item); en 3.1 el control pasó a
        // ser por nivel (`thinkingLevel`), sin un número de tokens exacto que
        // reservar — por eso `maxOutputTokens` se deja igual de generoso
        // (8192) en vez de restarle el budget de pensamiento como antes.
        generationConfig: {
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: 'LOW' },
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    },
  )

  if (!res.ok) {
    const rawBody = await res.text().catch(() => '<sin body>')
    console.error(`[extract-from-photo] Gemini no-ok: status=${res.status} body=${rawBody}`)
    if (res.status === 429) {
      const rl = parseRateLimit(rawBody)
      const msg = rl.kind === 'day' ? mensajeCuotaDiaria(rl.quotaValue) : mensajeCuotaCorta(rl.retryDelaySeconds)
      throw new GeminiError(msg, rl)
    }
    throw new GeminiError(translateGeminiError(res.status, rawBody))
  }

  const data = await res.json()
  const candidate = data?.candidates?.[0]
  if (!candidate) {
    console.error(`[extract-from-photo] Gemini 200 sin candidates: ${JSON.stringify(data)}`)
    throw new GeminiError('No pude leer la foto. Probá con otra imagen o sacala de nuevo con mejor luz.')
  }
  return candidate as GeminiCandidate
}

function messageForFinishReason(reason?: string): string {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'La foto tiene demasiado contenido y la lectura se cortó. Probá con una imagen más acotada (una parte a la vez).'
    case 'SAFETY':
      return 'Gemini bloqueó la lectura de esta imagen por contenido. Probá con otra foto.'
    case 'RECITATION':
      return 'Gemini bloqueó la lectura por recitación de contenido protegido. Probá con otra foto.'
    default:
      return `No pude leer la foto (motivo: ${reason ?? 'desconocido'}). Probá sacarla de nuevo con mejor luz o más cerca.`
  }
}

// Mensaje único para "la imagen llegó, Gemini respondió, pero no hay item".
// Sale por varios caminos (JSON ilegible, extracción vacía) y en todos el
// usuario tiene que hacer lo mismo, así que dice lo mismo.
const NO_SE_PUDO_LEER =
  'No pude interpretar la foto. Probá sacarla de nuevo con mejor luz, más cerca o más derecha.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Falta el header Authorization.' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const encryptionSecret = Deno.env.get('AI_KEY_ENCRYPTION_SECRET')
  if (!supabaseUrl || !supabaseAnonKey || !encryptionSecret) {
    return jsonResponse({ error: 'Función mal configurada (faltan secrets).' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError || !user) {
    return jsonResponse({ error: 'Sesión inválida o expirada.' }, 401)
  }

  const { data: settings } = await supabase
    .from('user_ai_settings')
    .select('ai_enabled, gemini_api_key_encrypted, daily_quota_learned')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!settings?.ai_enabled || !settings.gemini_api_key_encrypted) {
    return jsonResponse({ error: 'Activá la IA en Settings primero.' }, 400)
  }

  const learned: number | null = settings.daily_quota_learned ?? null

  // Mismo pre-flight que el asistente: si ya sabemos la cuota diaria y hoy se
  // agotó, cortamos acá sin gastar una llamada que igual daría 429 — y sin
  // mandar la imagen a ningún lado.
  if (learned != null) {
    const { data: usedToday } = await supabase.rpc('ai_usage_today')
    if (typeof usedToday === 'number' && usedToday >= learned) {
      return jsonResponse({
        respuesta_texto: mensajeCuotaDiaria(learned),
        rate_limit: { kind: 'day', quota_value: learned },
        usage: { used_today: usedToday, daily_quota: learned },
      })
    }
  }

  let body: {
    imagen_base64?: string
    mime_type?: string
    temas?: unknown
    client_now?: string
    /** Comentario opcional escrito antes de analizar. */
    comentario?: string
    /** Corrección posterior: la propuesta que se le mostró al usuario… */
    propuesta_anterior?: unknown
    /** …y lo que dice que está mal. Las dos juntas activan el modo corrección. */
    correccion?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido.' }, 400)
  }

  const imagenBase64 = typeof body.imagen_base64 === 'string' ? body.imagen_base64 : ''
  if (!imagenBase64) {
    return jsonResponse({ error: 'Falta la imagen.' }, 400)
  }
  if (imagenBase64.length > MAX_BASE64_BYTES) {
    return jsonResponse({ error: 'La imagen es demasiado grande. Probá con una foto más chica.' }, 413)
  }

  const mimeType = typeof body.mime_type === 'string' ? body.mime_type.toLowerCase() : 'image/jpeg'
  if (!MIMES_PERMITIDOS.has(mimeType)) {
    return jsonResponse({ error: 'Ese formato de imagen no está soportado. Usá una foto JPG, PNG o WEBP.' }, 400)
  }

  // La key se descifra recién acá: si el body venía mal, ni la tocamos.
  let apiKey: string
  try {
    apiKey = await decryptApiKey(settings.gemini_api_key_encrypted, encryptionSecret)
  } catch {
    return jsonResponse({ error: 'No se pudo descifrar la key. Volvé a guardarla en Settings.' }, 500)
  }

  const temas = Array.isArray(body.temas)
    ? body.temas.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).slice(0, 40)
    : []
  const clientNow = typeof body.client_now === 'string' ? body.client_now : undefined

  // Texto libre del usuario: se recorta a un tamaño razonable antes de entrar al
  // prompt. No es una defensa contra nada malicioso —es su propia cuenta y su
  // propia key—, sino contra un pegado accidental de diez páginas que se coma el
  // presupuesto de tokens que necesita la transcripción.
  const textoUsuario = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined
    const limpio = v.trim().slice(0, MAX_TEXTO_USUARIO)
    return limpio.length > 0 ? limpio : undefined
  }

  const comentario = textoUsuario(body.comentario)
  const textoCorreccion = textoUsuario(body.correccion)

  // La propuesta anterior vuelve del cliente, así que no se confía tal cual: se
  // pasa por el MISMO normalizador que sanea lo que devuelve Gemini. Sale una
  // AccionCrear con los campos conocidos y nada más, lista para serializar en el
  // prompt.
  const anterior =
    textoCorreccion && body.propuesta_anterior && typeof body.propuesta_anterior === 'object'
      ? (normalizarExtraccion(body.propuesta_anterior as Record<string, unknown>)?.accion ?? null)
      : null

  // El modo corrección necesita las dos mitades. Si falta una (el cliente mandó
  // el texto pero la propuesta llegó vacía o irreconocible), se degrada a una
  // lectura inicial en vez de fallar: peor sería un 400 con la foto ya subida.
  const correccion = anterior && textoCorreccion ? { anterior, texto: textoCorreccion } : undefined

  let usedToday: number | null = null
  const usageField = () => ({ usage: { used_today: usedToday ?? undefined, daily_quota: learned ?? undefined } })

  try {
    // Freno proactivo: chequeamos ANTES de gastar la llamada (compartida con
    // ai-assistant vía la misma tabla ai_call_log).
    const rpm = await reserveRpmSlot(supabase, user.id)
    if (!rpm.allowed) {
      return jsonResponse({
        respuesta_texto: mensajeRpmProactivo(rpm.retryAfterSeconds),
        rate_limit: { kind: 'short', retry_after_seconds: rpm.retryAfterSeconds },
        ...usageField(),
      })
    }

    const candidate = await callGeminiVision(
      apiKey,
      buildPrompt({ temas, clientNow, comentario, correccion }),
      imagenBase64,
      mimeType,
    )

    // Llamada exitosa: cuenta contra la misma cuota diaria que el chat.
    const { data: nuevo } = await supabase.rpc('increment_ai_usage')
    if (typeof nuevo === 'number') usedToday = nuevo

    const parts = candidate.content?.parts
    if (!parts || parts.length === 0) {
      console.error(
        `[extract-from-photo] candidate sin parts (finishReason=${candidate.finishReason ?? 'null'}): ${JSON.stringify(candidate)}`,
      )
      return jsonResponse({ respuesta_texto: messageForFinishReason(candidate.finishReason), ...usageField() })
    }

    const texto = parts
      .filter((p) => typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
      .trim()

    // El guard de arriba ("candidate sin parts") cubre el corte limpio: Gemini
    // no llegó a emitir nada y `finishReason` explica por qué. Pero hay un corte
    // sucio que se le escapaba: emitir parts con el JSON cortado a la mitad. Ahí
    // `parts` no está vacío, el parseo falla, y el usuario recibía "no pude
    // interpretar la foto — sacala con mejor luz", que lo manda a arreglar algo
    // que no está roto. Si el motivo real es MAX_TOKENS, se lo decimos.
    const truncado = candidate.finishReason === 'MAX_TOKENS'
    const noSePudo = truncado ? messageForFinishReason('MAX_TOKENS') : NO_SE_PUDO_LEER

    const crudo = texto ? parseJsonLaxo(texto) : null
    if (!crudo) {
      console.error(
        `[extract-from-photo] respuesta no parseable (finishReason=${candidate.finishReason ?? 'null'}): ${texto.slice(0, 500)}`,
      )
      return jsonResponse({ respuesta_texto: noSePudo, ...usageField() })
    }

    const extraccion = normalizarExtraccion(crudo)
    if (!extraccion) {
      return jsonResponse({ respuesta_texto: noSePudo, ...usageField() })
    }

    return jsonResponse({
      respuesta_texto: extraccion.resumen,
      accion_propuesta: extraccion.accion,
      ...usageField(),
    })
  } catch (err) {
    console.error('[extract-from-photo] fallo:', err instanceof Error ? (err.stack ?? err.message) : err)

    if (err instanceof GeminiError && err.rateLimit) {
      const rl = err.rateLimit
      if (rl.kind === 'day') {
        if (rl.quotaValue != null) {
          await supabase.from('user_ai_settings').update({ daily_quota_learned: rl.quotaValue }).eq('user_id', user.id)
        }
        return jsonResponse({
          respuesta_texto: err.userMessage,
          rate_limit: { kind: 'day', quota_value: rl.quotaValue ?? learned ?? undefined },
          ...usageField(),
        })
      }
      return jsonResponse({
        respuesta_texto: err.userMessage,
        rate_limit: { kind: 'short', retry_after_seconds: rl.retryDelaySeconds },
        ...usageField(),
      })
    }

    const mensaje =
      err instanceof GeminiError
        ? err.userMessage
        : 'Ocurrió un error inesperado al leer la foto. Intentá de nuevo en un momento.'
    return jsonResponse({ error: mensaje }, 502)
  }
})
