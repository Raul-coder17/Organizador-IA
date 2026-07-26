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
  collectProposals,
  fallbackTextForActions,
  partitionCalls,
} from './actions.ts'
import {
  buildContents,
  resumenContents,
  type GeminiContent,
  type GeminiPart,
  type MensajeHistorial,
} from './historial.ts'
import { decideRpmSlot } from './rpm.ts'

// gemini-3.1-flash-lite (no "-preview": esa variante quedó dada de baja).
// Confirmado contra la doc oficial (ai.google.dev/gemini-api/docs/models/
// gemini-3.1-flash-lite) que soporta function calling e imagen. OJO con el
// thinking: este modelo usa `thinkingLevel` (enum), NO el `thinkingBudget`
// (número de tokens) de la serie 2.5 — mandar los dos juntos da 400. Ver
// generationConfig más abajo.
const GEMINI_MODEL = 'gemini-3.1-flash-lite'
const MAX_TURNS = 5
// RPM real de este modelo para este proyecto (AI Studio, no la guía genérica
// de 1500/15). Es fijo, a diferencia de daily_quota_learned: no hay 429 del
// que "aprenderlo" de forma confiable con esta granularidad, así que se
// hardcodea como los límites conocidos del modelo/cuenta.
const GEMINI_RPM = 15
const RPM_WINDOW_MS = 60_000

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
// Los tres valores reales de la columna `recordatorios.recurrencia` + el
// centinela 'ninguna', que sólo tiene sentido al EDITAR (apagar la repetición
// de un recordatorio que ya la tenía, sin borrar el recordatorio).
const RECURRENCIA_ENUM = ['diario', 'semanal', 'mensual', 'dias_semana']
const RECURRENCIA_ENUM_UPDATE = [...RECURRENCIA_ENUM, 'ninguna']

// Descripción compartida por el campo de días de create y update: la convención
// (0=domingo, zona local) tiene que decirse igual en los dos lados o el modelo
// mandaría escalas distintas según la acción.
const DIAS_DESC =
  'Sólo con recordatorio_recurrencia = "dias_semana": qué días de la semana, como enteros donde 0=domingo, 1=lunes, 2=martes, 3=miércoles, 4=jueves, 5=viernes, 6=sábado. Ej. "los lunes, miércoles y viernes" = [1,3,5]; "los fines de semana" = [6,0]. Al menos uno.'

// Con "diario" y "dias_semana" la fecha de arranque no la elige nadie: sale de
// la hora + (si aplica) los días. Pedirle al modelo que calcule "el próximo
// lunes/miércoles/viernes a las 7" era aritmética de calendario que no tiene por
// qué hacer bien; con la hora sola, el cliente la calcula con la misma función
// que usa el form manual.
const HORA_DESC =
  'Hora del aviso en formato "HH:mm" 24h (ej. "07:00", "21:30"), en hora LOCAL del usuario. Usalo SÓLO con recordatorio_recurrencia = "diario" o "dias_semana", y en ese caso NO mandes recordatorio_fecha_hora: la primera fecha la calcula la app (la próxima vez que sea esa hora, corrida al próximo día marcado si hay días).'

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
      'Consulta los recordatorios del usuario (fecha/hora, estado, recurrencia y el item asociado). Solo lectura. Úsalo para tener contexto antes de crear, mover, repetir o quitar un recordatorio.',
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
            'OBLIGATORIO para nota, recordatorio y tabla: QUÉ es el item, en texto ("Ir al gym", "Tomar la pastilla"). Mandalo SIEMPRE, también cuando el item lleve recordatorio y/o recurrencia — sin esto el item se guarda vacío y no sirve. Para tipo "lista" NO uses esto: usá "lineas".',
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
            'Opcional: crea el item CON un recordatorio a esta fecha/hora LOCAL del usuario, en formato "YYYY-MM-DDTHH:mm" (ej. "2026-07-23T09:00"). Sirve para CUALQUIER tipo de item, no solo "recordatorio". Con recurrencia "diario" o "dias_semana" no lo mandes: usá recordatorio_hora.',
        },
        recordatorio_hora: {
          type: 'STRING',
          description: HORA_DESC,
        },
        recordatorio_recurrencia: {
          type: 'STRING',
          enum: RECURRENCIA_ENUM,
          description:
            'Opcional: hace que el recordatorio se REPITA. "diario" para todos los días, "semanal" cada 7 días, "mensual" cada mes, y "dias_semana" para días concretos de la semana (ahí además mandá recordatorio_dias). Con "diario" y "dias_semana" alcanza con recordatorio_hora; con "semanal" y "mensual" mandá recordatorio_fecha_hora, que es la PRIMERA vez. Después se reprograma solo. Si no se pide repetición, omitilo.',
        },
        recordatorio_dias: {
          type: 'ARRAY',
          items: { type: 'INTEGER' },
          description: DIAS_DESC,
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
            'Agrega o mueve el recordatorio del item a esta fecha/hora LOCAL "YYYY-MM-DDTHH:mm". Con recurrencia "diario" o "dias_semana" no lo mandes: usá recordatorio_hora.',
        },
        recordatorio_hora: {
          type: 'STRING',
          description: HORA_DESC,
        },
        recordatorio_recurrencia: {
          type: 'STRING',
          enum: RECURRENCIA_ENUM_UPDATE,
          description:
            'Cambia cada cuánto se repite el recordatorio del item. Con "dias_semana" mandá también recordatorio_dias. Usá "ninguna" para que DEJE de repetirse pero el recordatorio siga existiendo (distinto de quitar_recordatorio, que lo elimina). Omitilo si la repetición no cambia.',
        },
        recordatorio_dias: {
          type: 'ARRAY',
          items: { type: 'INTEGER' },
          description: `${DIAS_DESC} Al cambiar los días mandá la lista COMPLETA que queda, no sólo los que se agregan.`,
        },
        quitar_recordatorio: {
          type: 'BOOLEAN',
          description:
            'true para quitar por completo el recordatorio existente del item (fecha incluida).',
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
- TODO create lleva SIEMPRE el QUÉ del item: "contenido" para nota, recordatorio y tabla, o "lineas" para lista. Nunca lo omitas. La fecha, la hora, la repetición y los días dicen CUÁNDO avisar, no QUÉ es el item: un create con recordatorio_fecha_hora/recordatorio_recurrencia pero sin "contenido" guarda un item vacío. Si los ejemplos de más abajo enumeran sólo los campos de recordatorio, es para no repetirse: "contenido" va igual, siempre.
- Podés agregar un recordatorio a CUALQUIER item (no solo a los de tipo "recordatorio"): al crear, con "recordatorio_fecha_hora"; al editar, con "recordatorio_fecha_hora" (agregar/mover) o "quitar_recordatorio". La fecha/hora va en hora LOCAL del usuario, formato "YYYY-MM-DDTHH:mm".
- Un recordatorio puede REPETIRSE, con "recordatorio_recurrencia": "diario", "semanal", "mensual" o "dias_semana". No hay fecha de fin: la repetición sigue hasta que el usuario la saque.
- CUÁNDO empieza la repetición: con "diario" y "dias_semana" NO hace falta ninguna fecha — mandá sólo "recordatorio_hora" ("HH:mm") y la app calcula sola la primera vez (la próxima vez que sea esa hora, en un día que corresponda). Con "semanal" y "mensual" sí mandá "recordatorio_fecha_hora", porque ahí la fecha es la que define qué día de la semana o del mes se repite.
- Si el pedido dice "todos los días", "cada mañana" o parecido: recordatorio_recurrencia = "diario" + recordatorio_hora. Ejemplo: "recordame tomar la pastilla todos los días a las 9" = un create con tipo "recordatorio", contenido = "Tomar la pastilla", recordatorio_recurrencia = "diario" y recordatorio_hora = "09:00".
- Si el pedido nombra DÍAS CONCRETOS de la semana ("los lunes, miércoles y viernes", "todos los martes", "los fines de semana", "de lunes a viernes"), usá recordatorio_recurrencia = "dias_semana" MÁS "recordatorio_dias" con los números de esos días (0=domingo … 6=sábado) MÁS "recordatorio_hora". Ejemplo: "recordame ir al gym los lunes, miércoles y viernes a las 7" = un create con tipo "recordatorio", contenido = "Ir al gym", recordatorio_recurrencia = "dias_semana", recordatorio_dias = [1,3,5] y recordatorio_hora = "07:00". Ojo: "todos los martes" es dias_semana con [2], NO "semanal" a secas.
- "semanal" y "dias_semana" no son lo mismo: "semanal" repite cada 7 días desde la última vez (siempre el mismo día), "dias_semana" repite en los días que se nombren. Ante un pedido con días nombrados, elegí siempre "dias_semana".
- Cuando un recordatorio recurrente se cumple (el usuario lo marca hecho, o le llega el aviso), se reprograma SOLO para la vuelta siguiente. No propongas crear un item por cada repetición: es UN solo item con recurrencia.
- Para que algo DEJE de repetirse sin borrarlo, usá proposeUpdateItem con recordatorio_recurrencia = "ninguna". Para eliminar el recordatorio entero, usá quitar_recordatorio. No son lo mismo.
- Podés proponer VARIAS acciones en un mismo turno cuando el pedido lo implique. Ejemplos: "agregá una nota y ponele recordatorio para mañana 9" = UNA sola acción create con contenido + recordatorio_fecha_hora; "agregá leche y pan a mi lista del súper" (lista existente) = UN update con lineas_agregar=["leche","pan"]; "borrá la nota X y creá una tarea Y" = dos acciones (un delete + un create) en el mismo turno.
- Cuando el usuario quiera crear, editar o borrar algo, llamá a la función propose correspondiente. Esas acciones NO se ejecutan al instante: el usuario ve un preview y confirma. Después de proponer, decile en una frase qué va a pasar cuando confirme.
- Para editar o borrar necesitás el item_id real (obtenido de listItems). Si no lo tenés, consultá primero.${ahora}`
}

// ---------------------------------------------------------------------------

// `GeminiPart` y `GeminiContent` viven en historial.ts, que es quien arma el
// `contents`: tenerlos declarados en un solo lado evita que las dos formas del
// mismo payload se separen con el tiempo.
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

// Mensaje del freno PROACTIVO (nunca llegamos a llamar a Gemini): distinto del
// 429 real de arriba porque acá no hay retryDelay que Gemini nos haya dado, lo
// calculamos nosotros mismos a partir de nuestras propias marcas.
function mensajeRpmProactivo(segundos: number): string {
  return `Vas rápido con la IA: llegaste al máximo de ${GEMINI_RPM} mensajes por minuto. Esperá ${segundos} segundo${segundos === 1 ? '' : 's'} y volvé a intentar.`
}

// Antes de CADA llamada real a Gemini (acá o en extract-from-photo: comparten
// modelo y cuenta), chequea cuántas hubo en los últimos RPM_WINDOW_MS y decide
// si hay lugar. Poda sus propias marcas viejas de paso, así ai_call_log no
// crece sin límite con el uso normal.
//
// No es perfectamente atómico (leer + insertar son dos round-trips), igual
// que el pre-flight de daily_quota_learned de más abajo — aceptable acá: es
// una app de un solo usuario, no un sistema con contención real.
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

// ---------------------------------------------------------------------------
// Auditoría del intercambio con Gemini
//
// Va SOLO a los logs de la Edge Function (dashboard de Supabase): ninguna tabla
// persistente, nada de esto vuelve al cliente. Lo que se loguea es la
// conversación en sí — texto que el propio usuario escribió o vio, más items
// que ya le pertenecen. NO se loguea la API key (viaja aparte, en la query
// string del fetch, y nunca entra a `contents`), ni el blob cifrado, ni el
// secret de cifrado.
//
// Los logs de Supabase cortan las líneas largas, así que un payload grande se
// parte en trozos numerados para poder reconstruirlo entero después.
const LOG_CHUNK = 3000

function logJson(prefix: string, value: unknown) {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch (err) {
    console.log(`${prefix} <no serializable: ${err instanceof Error ? err.message : String(err)}>`)
    return
  }
  if (serialized.length <= LOG_CHUNK) {
    console.log(`${prefix} ${serialized}`)
    return
  }
  const total = Math.ceil(serialized.length / LOG_CHUNK)
  for (let i = 0; i < total; i++) {
    console.log(`${prefix} [parte ${i + 1}/${total}] ${serialized.slice(i * LOG_CHUNK, (i + 1) * LOG_CHUNK)}`)
  }
}

// Qué contestó Gemini en esta vuelta: las function calls con sus args COMPLETOS
// (que es donde se ve si mandó recordatorio_fecha_hora en vez de sólo
// recordatorio_hora) o, si no llamó a ninguna, el texto. Junto con el payload de
// ida alcanza para reconstruir un incidente real sin adivinar.
function logRespuestaGemini(turn: number, candidate: GeminiCandidate) {
  const parts = candidate.content?.parts ?? []
  const functionCalls = parts
    .filter((p) => p.functionCall)
    .map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {} }))
  logJson(
    `[ai-assistant][respuesta] turno=${turn} finishReason=${candidate.finishReason ?? 'null'} calls=${functionCalls.length}`,
    { function_calls: functionCalls, texto: textFromParts(parts) || null },
  )
}

// ---------------------------------------------------------------------------

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
        // Modelo "thinking": por defecto gasta parte del budget de salida
        // razonando, y con function-calling puede consumirlo entero antes de
        // emitir parts -> candidate sin parts + MAX_TOKENS. En la serie 2.5 esto
        // se apagaba con `thinkingBudget: 0`; en 3.1 ese campo es legacy y
        // mezclarlo con `thinkingLevel` da 400, así que el equivalente es el
        // nivel más bajo: MINIMAL (que además ya es el default del modelo, pero
        // se deja explícito por si ese default cambia).
        generationConfig: {
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
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
    .select('id, fecha_hora, estado, recurrencia, recurrencia_dias, item:items(id, tipo, contenido)')
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
      // null = de una sola vez. Va en el contexto para que el modelo no proponga
      // "hacerlo diario" algo que ya lo es, ni pierda la repetición al mover una
      // fecha.
      recurrencia: r.recurrencia ?? null,
      // Días guardados (escala UTC). Van al contexto sólo como referencia de que
      // el recordatorio tiene días fijos; si el modelo propone cambiarlos manda
      // la lista nueva completa en escala local y el cliente la convierte.
      recurrencia_dias: r.recurrencia_dias ?? null,
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
    .select('ai_enabled, gemini_api_key_encrypted, daily_quota_learned, daily_quota_learned_model')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!settings?.ai_enabled || !settings.gemini_api_key_encrypted) {
    return jsonResponse({ error: 'Activá la IA en Settings primero.' }, 400)
  }

  // La cuota aprendida vale SÓLO para el modelo bajo el que se aprendió: cada
  // modelo tiene su propio RPD. Si no coincide con el que estamos usando ahora
  // (cambio de modelo desde el último 429), se ignora y se reaprende del
  // próximo 429 real. Sin esto, el RPD viejo seguiría cortando al usuario
  // contra un límite que ya no existe.
  const learned: number | null =
    settings.daily_quota_learned_model === GEMINI_MODEL ? (settings.daily_quota_learned ?? null) : null

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

  let body: { messages?: MensajeHistorial[]; client_now?: string }
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

  // El historial NO es texto plano: los turnos en que el modelo propuso algo se
  // reconstruyen como el par functionCall/functionResponse real, para que Gemini
  // sepa qué se confirmó, qué se canceló y qué falló. Ver historial.ts.
  const contents: GeminiContent[] = buildContents(messages)
  if (contents.length === 0) {
    return jsonResponse({ error: 'Faltan mensajes.' }, 400)
  }

  // Cabecera del intercambio. `client_now` es lo único variable de la system
  // instruction y es la entrada con la que el modelo resuelve fechas relativas:
  // sin verla no se puede juzgar si una fecha que propuso estaba bien calculada.
  // El resumen del historial es lo que permite verificar de un vistazo que la
  // reconstrucción quedó bien: la secuencia de roles tiene que alternar
  // user/model y el conteo de calls tiene que coincidir con las propuestas.
  console.log(
    `[ai-assistant][payload] inicio modelo=${GEMINI_MODEL} client_now=${clientNow ?? '<ausente>'} mensajes_chat=${messages.length}`,
  )
  console.log(`[ai-assistant][payload] historial ${resumenContents(contents)}`)

  // Cada llamada exitosa a Gemini cuenta contra la cuota; llevamos el total
  // de hoy para el pre-flight de próximas y para mostrarlo en el frontend.
  let usedToday: number | null = null
  const usageField = () => ({ usage: { used_today: usedToday ?? undefined, daily_quota: learned ?? undefined } })

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // Freno proactivo: chequeamos ANTES de gastar la llamada, no después de
      // que Gemini nos devuelva un 429. Un solo turno de usuario puede pasar
      // por acá varias veces (un turno con lecturas + propuesta ya son 2).
      const rpm = await reserveRpmSlot(supabase, user.id)
      if (!rpm.allowed) {
        return jsonResponse({
          respuesta_texto: mensajeRpmProactivo(rpm.retryAfterSeconds),
          rate_limit: { kind: 'short', retry_after_seconds: rpm.retryAfterSeconds },
          ...usageField(),
        })
      }

      // El payload EXACTO de ESTA vuelta, no sólo el de la primera: a partir del
      // segundo turno `contents` ya trae el candidate anterior y los
      // functionResponse de las lecturas, que es justo el contexto que tenía el
      // modelo cuando decidió lo que decidió.
      logJson(`[ai-assistant][payload] turno=${turn} contents=`, contents)

      const candidate = await callGemini(apiKey, contents, systemInstruction)
      logRespuestaGemini(turn, candidate)

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
        const propuestas = collectProposals(proposes)
        const acciones = propuestas.map((p) => p.accion)
        const texto = textFromParts(parts) || fallbackTextForActions(acciones)
        return jsonResponse({
          respuesta_texto: texto,
          acciones_propuestas: acciones,
          // La call cruda de cada acción, en el MISMO orden que
          // `acciones_propuestas`. El cliente la guarda con el desenlace y nos la
          // devuelve en el próximo mensaje, y así el historial puede replicar el
          // turno tal como el modelo lo emitió en vez de parafrasearlo.
          calls_propuestas: propuestas.map((p) => ({ tool: p.call.name, args: p.call.args })),
          ...usageField(),
        })
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
        // Aprendemos la cuota diaria real para bloquear en el pre-flight futuro,
        // etiquetada con el modelo: si mañana cambiamos de modelo, este valor
        // deja de aplicar solo (ver el cálculo de `learned` más arriba).
        if (rl.quotaValue != null) {
          await supabase
            .from('user_ai_settings')
            .update({ daily_quota_learned: rl.quotaValue, daily_quota_learned_model: GEMINI_MODEL })
            .eq('user_id', user.id)
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
