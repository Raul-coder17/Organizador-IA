import type { Prioridad, TipoItem } from './database'

// Acciones que el asistente propone pero NO ejecuta: se muestran al usuario
// para preview y solo se ejecutan (contra Supabase, desde el frontend) tras
// confirmación explícita.

export interface AccionCrear {
  tipo_accion: 'create'
  tipo: TipoItem
  tema: string | null
  prioridad: Prioridad | null
  contenido: string
}

export interface AccionEditar {
  tipo_accion: 'update'
  item_id: string
  cambios: {
    tipo?: TipoItem
    tema?: string | null
    prioridad?: Prioridad | null
    contenido?: string
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
  accion?: AccionPropuesta
}

export interface AssistantResponse {
  respuesta_texto: string
  accion_propuesta?: AccionPropuesta
}
