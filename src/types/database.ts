// La paleta vive en lib/temaColores.ts, que es donde está la lógica de
// asignación; acá solo se referencia el tipo para tipar la columna.
import type { TemaColor } from '../lib/temaColores'
// Igual que TemaColor: el tipo vive con su lógica (el cálculo de la próxima
// ocurrencia), y acá sólo se referencia para tipar la columna.
import type { Recurrencia } from '../lib/recurrencia'

export type TipoItem = 'nota' | 'recordatorio' | 'lista' | 'tabla'
export type Prioridad = 'alta' | 'media' | 'baja'
export type OrigenItem = 'texto' | 'foto' | 'manual'
export type EstadoRecordatorio = 'pendiente' | 'enviado' | 'hecho'

export interface Tema {
  id: string
  user_id: string
  nombre: string
  // Slug de la paleta fría (no un color literal): lo resuelve a color el token
  // --color-tema-*, que cambia con el modo claro/oscuro.
  color: TemaColor
  created_at: string
  updated_at: string
}

export type TemaInsert = Omit<Tema, 'id' | 'color' | 'created_at' | 'updated_at'> &
  Partial<Pick<Tema, 'id' | 'color' | 'created_at' | 'updated_at'>>

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
  // null = de una sola vez (lo que eran TODOS los recordatorios hasta ahora).
  // Con valor, al marcarse 'enviado' o 'hecho' el recordatorio no se queda en
  // ese estado: avanza `fecha_hora` a la próxima vuelta y vuelve a 'pendiente'.
  // El cálculo vive en lib/recurrencia.ts (y su gemelo en la Edge Function).
  recurrencia: Recurrencia | null
  // Sólo para recurrencia 'dias_semana': qué días. Enteros 0-6 con 0=domingo,
  // la escala de getUTCDay() — o sea días de la semana EN UTC, no en la zona
  // del usuario (el form convierte; ver lib/recurrencia.ts). null para el resto
  // de las recurrencias, que la base además obliga con un check.
  recurrencia_dias: number[] | null
  created_at: string
  updated_at: string
}

export type RecordatorioInsert = Omit<
  Recordatorio,
  'id' | 'created_at' | 'updated_at' | 'estado' | 'recurrencia' | 'recurrencia_dias'
> &
  Partial<
    Pick<
      Recordatorio,
      'id' | 'created_at' | 'updated_at' | 'estado' | 'recurrencia' | 'recurrencia_dias'
    >
  >

// Un recordatorio con el item asociado embebido (join), como lo devuelve
// listRecordatorios para la pantalla de recordatorios.
export interface RecordatorioConItem extends Recordatorio {
  item: Pick<Item, 'id' | 'tipo' | 'contenido' | 'tema_id' | 'prioridad'> | null
}

// Fila de push_subscriptions (una por navegador/dispositivo suscripto).
export interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

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
