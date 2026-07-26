import type { Recurrencia } from '../lib/recurrencia'
import type { Prioridad, TipoItem } from './database'

// Acciones que el asistente propone pero NO ejecuta: se muestran al usuario
// para preview y solo se ejecutan (contra Supabase, desde el frontend) tras
// confirmación explícita.

export interface AccionCrear {
  tipo_accion: 'create'
  tipo: TipoItem
  tema: string | null
  prioridad: Prioridad | null
  contenido?: string
  // Para tipo 'lista': cada string es una línea marcable.
  lineas?: string[]
  // Para tipo 'tabla': encabezados y filas ya separados en celdas. Los emite hoy
  // sólo la extracción por foto (ítem 14) — el asistente sigue proponiendo las
  // tablas como texto con pipes en `contenido`, y las dos formas conviven porque
  // `ItemList` ya sabe leer las dos. Son opcionales: nada que consuma una
  // AccionCrear se rompe si no vienen.
  columnas?: string[]
  filas?: string[][]
  // Fecha/hora local ingenua ("YYYY-MM-DDTHH:mm"); se convierte a ISO/UTC con la
  // zona del navegador al confirmar (igual que el form manual).
  recordatorio_fecha_hora?: string
  // Hora local sola ("HH:mm"), sin fecha: es lo que manda el asistente con
  // recurrencia 'diario' o 'dias_semana', donde la fecha no la elige nadie. La
  // primera vuelta la calcula el cliente con `proximaFechaConHora`, la misma
  // función que usa el form manual para esas dos recurrencias.
  recordatorio_hora?: string
  // Ausente = recordatorio de una sola vez. Con valor, `recordatorio_fecha_hora`
  // (o la fecha calculada desde `recordatorio_hora`) es la PRIMERA vuelta y
  // después se reprograma solo.
  recordatorio_recurrencia?: Recurrencia
  // Sólo con recurrencia 'dias_semana'. Días 0-6 (0=domingo) en la zona LOCAL
  // del usuario, igual que `recordatorio_fecha_hora` viaja como hora local: el
  // frontend los convierte a la escala UTC que se guarda, al confirmar.
  recordatorio_dias?: number[]
}

export interface AccionEditar {
  tipo_accion: 'update'
  item_id: string
  cambios: {
    tipo?: TipoItem
    tema?: string | null
    prioridad?: Prioridad | null
    contenido?: string
    lineas_agregar?: string[]
    lineas_quitar?: string[]
    lineas_marcar_hechas?: string[]
    lineas_desmarcar?: string[]
    recordatorio_fecha_hora?: string
    // Hora sola ("HH:mm"), igual que en AccionCrear.
    recordatorio_hora?: string
    // Ausente = no se toca la repetición. `null` = que deje de repetirse (pero
    // el recordatorio sigue existiendo, a diferencia de quitar_recordatorio).
    recordatorio_recurrencia?: Recurrencia | null
    // Días 0-6 (0=domingo) en zona LOCAL, sólo con 'dias_semana'.
    recordatorio_dias?: number[]
    quitar_recordatorio?: boolean
  }
  resumen?: string
}

export interface AccionBorrar {
  tipo_accion: 'delete'
  item_id: string
  resumen?: string
}

export type AccionPropuesta = AccionCrear | AccionEditar | AccionBorrar

// La function call cruda con la que el asistente propuso una acción, tal como la
// emitió Gemini. Viaja del backend al cliente y vuelve, sin que el cliente la
// interprete: es sólo lo que hay que devolverle al modelo para que reconozca su
// propia jugada en el historial. Lo que el cliente SÍ interpreta y aplica es la
// `AccionPropuesta` normalizada que viene al lado.
export interface CallPropuesta {
  tool: string
  args: Record<string, unknown>
}

// Cómo terminó una acción propuesta. 'sin_responder' no lo elige el usuario: es
// lo que queda cuando sigue escribiendo sin tocar la tarjeta.
export type EstadoAccionHistorial = 'aplicada' | 'cancelada' | 'error' | 'sin_responder'

// Una acción propuesta con todo lo que hace falta para reconstruir el turno en
// el historial: la call original, la acción normalizada (para dibujar) y el
// desenlace real.
export interface AccionEnHistorial {
  accion: AccionPropuesta
  call?: CallPropuesta
  estado: EstadoAccionHistorial
  // Id del item afectado cuando la acción se aplicó. Para create sale recién al
  // crearlo; para update/delete ya venía en la propuesta.
  item_id?: string
  error?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  // Acciones propuestas en este mensaje del asistente (0, 1 o varias), con su
  // desenlace. Es lo que el backend convierte en functionCall/functionResponse.
  acciones?: AccionEnHistorial[]
  // Mensajes que existen sólo para que el usuario vea qué pasó ("Listo, creé el
  // item."). No se mandan al backend: lo que dicen ya está, con más precisión,
  // en el functionResponse de la acción, y mandarlos además dejaría dos turnos
  // 'model' seguidos.
  solo_ui?: boolean
}

export interface RateLimit {
  kind: 'day' | 'short'
  retry_after_seconds?: number
  quota_value?: number
}

export interface AssistantUsage {
  used_today?: number
  daily_quota?: number
}

export interface AssistantResponse {
  respuesta_texto: string
  // El asistente puede proponer varias acciones en un mismo turno.
  acciones_propuestas?: AccionPropuesta[]
  // Las function calls crudas de esas acciones, en el MISMO orden. Se guardan
  // junto al desenlace de cada una y se devuelven en el próximo mensaje.
  calls_propuestas?: CallPropuesta[]
  rate_limit?: RateLimit
  usage?: AssistantUsage
}

// Respuesta de la Edge Function `extract-from-photo` (ítem 14). Misma familia
// que `AssistantResponse` —comparte cuota, rate limit y mensajes en español—,
// pero una foto propone UNA acción y siempre de tipo `create`, así que el campo
// es singular y con el tipo estrecho: la tarjeta de preview es la misma, el
// resto del flujo no tiene por qué contemplar updates ni deletes que no existen.
//
// `accion_propuesta` ausente = la foto no se pudo interpretar (o se agotó la
// cuota): en ese caso `respuesta_texto` trae el motivo, ya en español.
export interface PhotoExtractResponse {
  respuesta_texto: string
  accion_propuesta?: AccionCrear
  rate_limit?: RateLimit
  usage?: AssistantUsage
}
