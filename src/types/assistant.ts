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
  // Fecha/hora local ingenua ("YYYY-MM-DDTHH:mm"); se convierte a ISO/UTC con la
  // zona del navegador al confirmar (igual que el form manual).
  recordatorio_fecha_hora?: string
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

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  // Acciones propuestas asociadas a este mensaje del asistente (0, 1 o varias).
  acciones?: AccionPropuesta[]
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
  rate_limit?: RateLimit
  usage?: AssistantUsage
}
