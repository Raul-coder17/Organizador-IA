export type TipoItem = 'nota' | 'recordatorio' | 'lista' | 'tabla'
export type Prioridad = 'alta' | 'media' | 'baja'
export type OrigenItem = 'texto' | 'foto' | 'manual'
export type EstadoRecordatorio = 'pendiente' | 'enviado' | 'hecho'

export interface Tema {
  id: string
  user_id: string
  nombre: string
  created_at: string
}

export type TemaInsert = Omit<Tema, 'id' | 'created_at'> &
  Partial<Pick<Tema, 'id' | 'created_at'>>

// Una línea de un item tipo "lista" (contenido = { items: LineaLista[] }).
export interface LineaLista {
  id: string
  texto: string
  hecho: boolean
}

export interface Item {
  id: string
  user_id: string
  tema_id: string | null
  tipo: TipoItem
  prioridad: Prioridad | null
  contenido: Record<string, unknown>
  origen: OrigenItem | null
  created_at: string
  updated_at: string
}

export type ItemInsert = Omit<Item, 'id' | 'created_at' | 'updated_at'> &
  Partial<Pick<Item, 'id' | 'created_at' | 'updated_at'>>

export interface Recordatorio {
  id: string
  item_id: string
  fecha_hora: string
  estado: EstadoRecordatorio
  created_at: string
}

export type RecordatorioInsert = Omit<Recordatorio, 'id' | 'created_at' | 'estado'> &
  Partial<Pick<Recordatorio, 'id' | 'created_at' | 'estado'>>

export interface UserAiSettings {
  user_id: string
  gemini_api_key_encrypted: string | null
  ai_enabled: boolean
  daily_quota_learned: number | null
  updated_at: string
}

export interface AiUsage {
  user_id: string
  fecha: string
  requests: number
}
