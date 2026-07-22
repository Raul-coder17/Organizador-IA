// Edge Function: ai-assistant
//
// Asistente de IA (solo texto) con function-calling contra Gemini. Descifra
// la key del usuario, le da a Gemini herramientas para consultar y proponer
// cambios sobre sus items, y devuelve { respuesta_texto, accion_propuesta? }.
//
// Reglas de seguridad clave:
// - Requiere JWT de usuario válido + ai_enabled = true con key guardada.
// - `listItems` (solo lectura) SÍ se ejecuta acá para dar contexto real a
//   Gemini, usando el JWT del usuario => respeta RLS.
// - `proposeCreateItem/proposeUpdateItem/proposeDeleteItem` NO se ejecutan
//   acá: se devuelven al frontend como `accion_propuesta` para que el
//   usuario confirme antes de aplicar el cambio real.
// - La key descifrada nunca se persiste ni se devuelve al cliente.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  allFunctionCalls,
  collectProposedActions,
  fallbackTextForActions,
  partitionCalls,
} from './actions.ts'

const GEMINI_MODEL = 'gemini-2.5-flash'
const MAX_TURNS = 5

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
// Declaración de tools para Gemini (tipos en mayúscula como pide la API)
// ---------------------------------------------------------------------------

const TIPO_ENUM = ['nota', 'recordatorio', 'lista', 'tabla']
const PRIORIDAD_ENUM = ['alta', 'media', 'baja']

const FUNCTION_DECLARATIONS = [
  {
    name: 'listItems',
    description:
      'Consulta los items del usuario. Úsalo para responder preguntas sobre qué tiene guardado y para tener contexto real antes de proponer crear, editar o borrar algo. Es solo lectura.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tema: { type: 'STRING', description: 'Filtra por nombre exacto de tema (opcional).' },
        tipo: { type: 'STRING', enum: TIPO_ENUM, description: 'Filtra por tipo (opcional).' },
        prioridad: { type: 'STRING', enum: PRIORIDAD_ENUM, description: 'Filtra por prioridad (opcional).' },
      },
    },
  },
  {
    name: 'listRecordatorios',
    description:
      'Consulta los recordatorios del usuario (fecha/hora, estado y el item asociado). Solo lectura. Úsalo para tener contexto antes de crear, mover o quitar un recordatorio.',
    parameters: {
      type: 'OBJECT',
      properties: {
        estado: {
          type: 'STRING',
          enum: ['pendiente', 'enviado', 'hecho'],
          description: 'Filtra por estado (opcional).',
        },
      },
    },
  },
  {
    name: 'proposeCreateItem',
    description:
      'Propone crear un item nuevo. NO lo crea: el usuario verá un preview y deberá confirmar. Usa esto cuando el usuario pida agregar/guardar algo. Podés crear el item CON un recordatorio en la misma acción.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tipo: { type: 'STRING', enum: TIPO_ENUM, description: 'Tipo del item.' },
        tema: { type: 'STRING', description: 'Nombre del tema (existente o nuevo). Opcional.' },
        prioridad: { type: 'STRING', enum: PRIORIDAD_ENUM, description: 'Prioridad. Opcional.' },
        contenido: {
          type: 'STRING',
          description:
            'Contenido en texto (para nota, recordatorio o tabla). Para tipo "lista" NO uses esto: usá "lineas".',
        },
        lineas: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description:
            'Solo para tipo "lista": cada string es una línea marcable de la lista (ej. ["leche","pan"]).',
        },
        recordatorio_fecha_hora: {
          type: 'STRING',
          description:
            'Opcional: crea el item CON un recordatorio a esta fecha/hora LOCAL del usuario, en formato "YYYY-MM-DDTHH:mm" (ej. "2026-07-23T09:00"). Sirve para CUALQUIER tipo de item, no solo "recordatorio".',
        },
      },
      required: ['tipo'],
    },
  },
  {
    name: 'proposeUpdateItem',
    description:
      'Propone editar un item existente (identificado por item_id, que obtenés de listItems). NO lo edita: el usuario confirma primero. Incluí solo los campos a cambiar. Podés editar líneas de una lista y/o su recordatorio.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item_id: { type: 'STRING', description: 'UUID del item a editar (de listItems).' },
        tipo: { type: 'STRING', enum: TIPO_ENUM },
        tema: { type: 'STRING', description: 'Nuevo nombre de tema.' },
        prioridad: { type: 'STRING', enum: PRIORIDAD_ENUM },
        contenido: {
          type: 'STRING',
          description: 'Nuevo contenido en texto (para nota/recordatorio/tabla).',
        },
        lineas_agregar: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Para tipo "lista": líneas nuevas a agregar (ej. ["leche","pan"]).',
        },
        lineas_quitar: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Para tipo "lista": textos EXACTOS de líneas existentes a quitar.',
        },
        lineas_marcar_hechas: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Para tipo "lista": textos de líneas a marcar como hechas.',
        },
        lineas_desmarcar: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Para tipo "lista": textos de líneas a desmarcar (volver a pendiente).',
        },
        recordatorio_fecha_hora: {
          type: 'STRING',
          description:
            'Agrega o mueve el recordatorio del item a esta fecha/hora LOCAL "YYYY-MM-DDTHH:mm".',
        },
        quitar_recordatorio: {
          type: 'BOOLEAN',
          description: 'true para quitar el recordatorio existente del item.',
        },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'proposeDeleteItem',
    description:
      'Propone borrar un item existente (item_id de listItems). NO lo borra: el usuario confirma primero.',
    parameters: {
      type: 'OBJECT',
      properties: {
        item_id: { type: 'STRING', description: 'UUID del item a borrar (de listItems).' },
      },
      required: ['item_id'],
    },
  },
]

function buildSystemInstruction(clientNow?: string): string {
  const ahora = clientNow
    ? `\n- La fecha y hora LOCAL del usuario ahora es: ${clientNow} (formato "YYYY-MM-DDTHH:mm"). Usala para calcular fechas relativas como "mañana a las 9" o "en 2 horas".`
    : ''
  return `Sos el asistente del "Organizador Personal IA". Ayudás al usuario a consultar y organizar sus items (notas, recordatorios, listas, tablas) por tema y prioridad. Respondé siempre en español, breve y claro.

Reglas:
- Antes de responder sobre qué tiene guardado, o antes de proponer cambios sobre un item existente, usá listItems (y listRecordatorios si el pedido involucra recordatorios) para ver datos reales. No inventes items ni ids.
- Tipos válidos: nota, recordatorio, lista, tabla. Prioridades válidas: alta, media, baja (o sin prioridad).
- El tipo "lista" tiene líneas marcables (checkboxes), NO texto libre. Para crear una lista usá el campo "lineas" (un array de strings), no "contenido". Para editar sus líneas usá lineas_agregar / lineas_quitar / lineas_marcar_hechas / lineas_desmarcar.
- Podés agregar un recordatorio a CUALQUIER item (no solo a los de tipo "recordatorio"): al crear, con "recordatorio_fecha_hora"; al editar, con "recordatorio_fecha_hora" (agregar/mover) o "quitar_recordatorio". La fecha/hora va en hora LOCAL del usuario, formato "YYYY-MM-DDTHH:mm".
- Podés proponer VARIAS acciones en un mismo turno cuando el pedido lo implique. Ejemplos: "agregá una nota y ponele recordatorio para mañana 9" = UNA sola acción create con contenido + recordatorio_fecha_hora; "agregá leche y pan a mi lista del súper" (lista existente) = UN update con lineas_agregar=["leche","pan"]; "borrá la nota X y creá una tarea Y" = dos acciones (un delete + un create) en el mismo turno.
- Cuando el usuario quiera crear, editar o borrar algo, llamá a la función propose correspondiente. Esas acciones NO se ejecutan al instante: el usuario ve un preview y confirma. Después de proponer, decile en una frase qué va a pasar cuando confirme.
- Para editar o borrar necesitás el item_id real (obtenido de listItems). Si no lo tenés, consultá primero.${ahora}`
}

// ---------------------------------------------------------------------------

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}
interface GeminiContent {
  role: string
  parts?: GeminiPart[]
}
interface GeminiCandidate {
  content?: GeminiContent
  finishReason?: string
}

// Info de rate limit aprendida de un 429 (nada hardcodeado): el propio body
// de Gemini trae el quotaId, el quotaValue real y el retryDelay.
interface RateLimitInfo {
  kind: 'day' | 'short'
  quotaValue?: number
  retryDelaySeconds?: number
  quotaId?: string
}

// Error con mensaje ya traducido al español, apto para mostrar al usuario.
// Si viene de un 429, adjunta la info de rate limit para que el handler
// decida (aprender la cuota diaria / devolver cuenta regresiva).
class GeminiError extends Error {
  constructor(
    public userMessage: string,
    public rateLimit?: RateLimitInfo,
  ) {
    super(userMessage)
    this.name = 'GeminiError'
  }
}

// Extrae del body de un 429 el tipo de límite (día vs corto), el quotaValue
// real y el retryDelay. No asume ningún número: todo sale del body.
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
        : // sin quotaId claro: si el retryDelay es corto lo tratamos como corto,
          // si no, como diario (conservador: evita reintentos que gastan cuota).
          retryDelaySeconds != null && retryDelaySeconds <= 120
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

// Clasifica un no-2xx de Gemini a un mensaje claro en español. El body crudo
// se loguea aparte (console.error) para diagnóstico; nunca se muestra al user.
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

async function callGemini(
  apiKey: string,
  contents: GeminiContent[],
  systemInstruction: string,
): Promise<GeminiCandidate> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
        // gemini-2.5-flash es un modelo "thinking": por defecto gasta parte del
        // budget de salida razonando, y con function-calling puede consumirlo
        // entero antes de emitir parts -> candidate sin parts + MAX_TOKENS.
        // Desactivamos el thinking (budget 0) y dejamos margen de salida.
        generationConfig: {
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  )

  if (!res.ok) {
    const rawBody = await res.text().catch(() => '<sin body>')
    console.error(`[ai-assistant] Gemini no-ok: status=${res.status} body=${rawBody}`)
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
    console.error(`[ai-assistant] Gemini 200 sin candidates: ${JSON.stringify(data)}`)
    throw new Error(`Respuesta de Gemini sin candidates: ${JSON.stringify(data)}`)
  }
  return candidate as GeminiCandidate
}

function messageForFinishReason(reason?: string): string {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'La respuesta se cortó por límite de tokens. Probá un mensaje más corto o reformulá.'
    case 'SAFETY':
      return 'Gemini bloqueó la respuesta por contenido. Reformulá el pedido.'
    case 'RECITATION':
      return 'Gemini bloqueó la respuesta por recitación de contenido protegido. Reformulá el pedido.'
    default:
      return `No pude generar una respuesta (motivo: ${reason ?? 'desconocido'}). Probá reformular el pedido.`
  }
}

function textFromParts(parts: GeminiPart[]): string {
  return parts
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim()
}

async function execListItems(
  supabase: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data: temas } = await supabase.from('temas').select('id, nombre').eq('user_id', userId)
  const temaMap = new Map((temas ?? []).map((t) => [t.id as string, t.nombre as string]))

  let query = supabase.from('items').select('*').eq('user_id', userId).order('created_at', { ascending: false })

  if (typeof args.tipo === 'string') query = query.eq('tipo', args.tipo)
  if (typeof args.prioridad === 'string') query = query.eq('prioridad', args.prioridad)

  if (typeof args.tema === 'string' && args.tema.trim()) {
    const matches = (temas ?? []).filter((t) => (t.nombre as string).toLowerCase() === args.tema!.toString().toLowerCase())
    if (matches.length === 0) return { items: [] }
    query = query.in('tema_id', matches.map((t) => t.id))
  }

  const { data: items, error } = await query
  if (error) return { error: 'No se pudieron leer los items.' }

  const compact = (items ?? []).map((it) => ({
    id: it.id,
    tipo: it.tipo,
    tema: it.tema_id ? (temaMap.get(it.tema_id) ?? null) : null,
    prioridad: it.prioridad,
    contenido: typeof it.contenido?.texto === 'string' ? it.contenido.texto : it.contenido,
    created_at: it.created_at,
  }))

  return { items: compact }
}

// Lectura server-side de recordatorios (respeta RLS con el JWT del usuario: la
// policy de `recordatorios` ya restringe a los que cuelgan de items del user).
async function execListRecordatorios(
  supabase: SupabaseClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  let query = supabase
    .from('recordatorios')
    .select('id, fecha_hora, estado, item:items(id, tipo, contenido)')
    .order('fecha_hora', { ascending: true })

  if (typeof args.estado === 'string') query = query.eq('estado', args.estado)

  const { data, error } = await query
  if (error) return { error: 'No se pudieron leer los recordatorios.' }

  const compact = (data ?? []).map((r) => {
    const item = (r as { item?: { id?: string; tipo?: string; contenido?: { texto?: unknown } } }).item
    return {
      id: r.id,
      item_id: item?.id ?? null,
      item_tipo: item?.tipo ?? null,
      item_contenido:
        item && typeof item.contenido?.texto === 'string' ? item.contenido.texto : (item?.contenido ?? null),
      fecha_hora: r.fecha_hora,
      estado: r.estado,
    }
  })

  return { recordatorios: compact }
}

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

  // Estado de IA + key cifrada + cuota diaria aprendida (respeta RLS con su JWT).
  const { data: settings } = await supabase
    .from('user_ai_settings')
    .select('ai_enabled, gemini_api_key_encrypted, daily_quota_learned')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!settings?.ai_enabled || !settings.gemini_api_key_encrypted) {
    return jsonResponse({ error: 'Activá la IA en Settings primero.' }, 400)
  }

  const learned: number | null = settings.daily_quota_learned ?? null

  // Pre-flight: si ya aprendimos la cuota diaria y hoy la alcanzamos,
  // respondemos al instante sin gastar una llamada a Gemini que igual daría 429.
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

  let apiKey: string
  try {
    apiKey = await decryptApiKey(settings.gemini_api_key_encrypted, encryptionSecret)
  } catch {
    return jsonResponse({ error: 'No se pudo descifrar la key. Volvé a guardarla en Settings.' }, 500)
  }

  let body: { messages?: { role?: string; text?: string }[]; client_now?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body inválido.' }, 400)
  }

  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) {
    return jsonResponse({ error: 'Faltan mensajes.' }, 400)
  }

  // Hora local del cliente (formato "YYYY-MM-DDTHH:mm") para resolver fechas
  // relativas ("mañana a las 9"). El server solo conoce UTC.
  const clientNow = typeof body.client_now === 'string' ? body.client_now : undefined
  const systemInstruction = buildSystemInstruction(clientNow)

  const contents: GeminiContent[] = messages
    .filter((m) => typeof m.text === 'string' && m.text.trim())
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text as string }],
    }))

  // Cada llamada exitosa a Gemini cuenta contra la cuota; llevamos el total
  // de hoy para el pre-flight de próximas y para mostrarlo en el frontend.
  let usedToday: number | null = null
  const usageField = () => ({ usage: { used_today: usedToday ?? undefined, daily_quota: learned ?? undefined } })

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const candidate = await callGemini(apiKey, contents, systemInstruction)

      // Llamada exitosa: incrementamos el contador diario (atómico, respeta RLS).
      const { data: nuevo } = await supabase.rpc('increment_ai_usage')
      if (typeof nuevo === 'number') usedToday = nuevo

      const parts = candidate.content?.parts

      // Fix defensivo: un candidate puede venir sin parts (MAX_TOKENS, SAFETY,
      // etc.). No explotamos: logueamos el candidate completo con su
      // finishReason y devolvemos 200 con un mensaje claro para el usuario.
      if (!parts || parts.length === 0) {
        console.error(
          `[ai-assistant] candidate sin parts (finishReason=${candidate.finishReason ?? 'null'}): ${JSON.stringify(candidate)}`,
        )
        return jsonResponse({ respuesta_texto: messageForFinishReason(candidate.finishReason), ...usageField() })
      }

      // Gemini puede devolver VARIAS function calls en un mismo turno (parallel
      // function calling). Las separamos en lecturas vs. acciones proponibles.
      const calls = allFunctionCalls(parts)

      if (calls.length === 0) {
        return jsonResponse({ respuesta_texto: textFromParts(parts) || 'Listo.', ...usageField() })
      }

      const { reads, proposes } = partitionCalls(calls)

      // Prioridad: si hay acciones propuestas, las devolvemos TODAS juntas (no
      // seguimos el loop). Así evitamos además responder function-calls a medias.
      if (proposes.length > 0) {
        const acciones = collectProposedActions(proposes)
        const texto = textFromParts(parts) || fallbackTextForActions(acciones)
        return jsonResponse({ respuesta_texto: texto, acciones_propuestas: acciones, ...usageField() })
      }

      // Solo lecturas: ejecutamos TODAS server-side y devolvemos sus resultados
      // como functionResponse (uno por cada call) para el próximo turno.
      if (reads.length > 0) {
        contents.push(candidate.content!)
        const responseParts: GeminiPart[] = []
        for (const r of reads) {
          const result =
            r.name === 'listRecordatorios'
              ? await execListRecordatorios(supabase, r.args)
              : await execListItems(supabase, user.id, r.args)
          responseParts.push({ functionResponse: { name: r.name, response: result as Record<string, unknown> } })
        }
        contents.push({ role: 'user', parts: responseParts })
        continue
      }

      // Solo function-calls desconocidas: cortamos para no colgar el loop.
      return jsonResponse({ respuesta_texto: textFromParts(parts) || 'No pude completar eso.', ...usageField() })
    }

    return jsonResponse({ respuesta_texto: 'No pude terminar de procesar el pedido. Probá reformularlo.', ...usageField() })
  } catch (err) {
    console.error('[ai-assistant] fallo en el loop:', err instanceof Error ? err.stack ?? err.message : err)

    // 429: manejo adaptativo según la info aprendida del propio body de Gemini.
    if (err instanceof GeminiError && err.rateLimit) {
      const rl = err.rateLimit
      if (rl.kind === 'day') {
        // Aprendemos la cuota diaria real para bloquear en el pre-flight futuro.
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
        : 'Ocurrió un error inesperado con el asistente. Intentá de nuevo en un momento.'
    return jsonResponse({ error: mensaje }, 502)
  }
})
