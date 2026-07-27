// Acceso de LECTURA a `recordatorios` en el servidor + helpers de presentación.
// Las mutaciones (crear/editar/borrar, marcar hecho/enviado) pasan por repo.ts
// y las sube sync.ts; ver la nota en items.ts.

import { supabase } from './supabase'
import type { Item, Recordatorio, RecordatorioConItem } from '../types/database'

// El resumen del contenido de un item y el armado de la notificación de un
// recordatorio viven en notificacionRecordatorio.ts (sin Supabase, testeable
// con `deno test`) y se re-exportan acá, que es de donde los importa el resto
// de la UI (RecordatorioRow, etc.).
export {
  ACCIONES_POSPONER,
  contenidoNotificacion,
  resumenContenido,
  type ContenidoNotificacion,
} from './notificacionRecordatorio'

// Rearma la forma RecordatorioConItem (recordatorio + item embebido) que usa la
// pantalla de recordatorios, uniendo recordatorios planos con los items
// cacheados. Se usa para hidratar /reminders desde IndexedDB sin red: online el
// item embebido lo trae el join del server; offline lo reconstruimos de la
// caché de items. Si el item no está cacheado, item queda null (resumenContenido
// lo maneja).
// Descarta el item embebido para guardar solo la fila plana en la caché local
// (el store `recordatorios` guarda Recordatorio, no RecordatorioConItem).
export function toPlainRecordatorio(r: RecordatorioConItem): Recordatorio {
  return {
    id: r.id,
    item_id: r.item_id,
    fecha_hora: r.fecha_hora,
    estado: r.estado,
    recurrencia: r.recurrencia ?? null,
    recurrencia_dias: r.recurrencia_dias ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

export function joinRecordatoriosConItems(
  recordatorios: Recordatorio[],
  items: Item[],
): RecordatorioConItem[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  return recordatorios.map((r) => {
    const it = byId.get(r.item_id)
    return {
      ...r,
      item: it
        ? {
            id: it.id,
            tipo: it.tipo,
            contenido: it.contenido,
            tema_id: it.tema_id,
            prioridad: it.prioridad,
          }
        : null,
    }
  })
}

// Columnas del item que necesitamos para mostrar el recordatorio en la lista.
const ITEM_COLS = 'id, tipo, contenido, tema_id, prioridad'

// Lista los recordatorios del usuario, ordenados por fecha_hora ascendente, con
// el item asociado embebido. No hace falta filtrar por user_id: la RLS de
// `recordatorios` ya restringe a los recordatorios cuyo item pertenece al
// usuario autenticado (y el join a `items` está igualmente protegido).
export async function listRecordatorios(): Promise<RecordatorioConItem[]> {
  const { data, error } = await supabase
    .from('recordatorios')
    .select(`*, item:items(${ITEM_COLS})`)
    .order('fecha_hora', { ascending: true })

  if (error) throw error
  return (data ?? []) as unknown as RecordatorioConItem[]
}

// --- Clasificación por estado ----------------------------------------------
//
// Vive acá, y no en la página de recordatorios donde nació, porque la vista Hoy
// necesita exactamente el mismo criterio (ítem 8): si "vencido" quisiera decir
// una cosa en /reminders y otra en Hoy, los dos números que el usuario ve al
// mismo tiempo se contradirían.

export type EstadoRecordatorio = 'vencido' | 'hoy' | 'proximo' | 'hecho'

export const ESTADO_LABEL: Record<EstadoRecordatorio, string> = {
  vencido: 'Vencido',
  hoy: 'Hoy',
  proximo: 'Próximo',
  hecho: 'Hecho',
}

export const TIPO_LABEL: Record<string, string> = {
  nota: 'Nota',
  recordatorio: 'Recordatorio',
  lista: 'Lista',
  tabla: 'Tabla',
}

export function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// Clasifica un recordatorio: hecho si su estado ya es 'hecho'; vencido si su
// fecha ya pasó y sigue pendiente; hoy si todavía no venció pero es del día en
// curso; próximo en el resto de los casos.
//
// Pide lo mínimo que mira (estado + fecha) en vez de un RecordatorioConItem, así
// sirve igual para la fila plana de la caché y para la unida con su item.
export function clasificar(
  rec: Pick<Recordatorio, 'estado' | 'fecha_hora'>,
  ahora: Date,
): EstadoRecordatorio {
  if (rec.estado === 'hecho') return 'hecho'
  const fecha = new Date(rec.fecha_hora)
  if (fecha.getTime() < ahora.getTime()) return 'vencido'
  if (mismoDia(fecha, ahora)) return 'hoy'
  return 'proximo'
}

// --- Helpers de fecha/hora --------------------------------------------------
//
// Viven en `fechaLocal.ts` (puro, sin Supabase, testeable con `deno test`) y se
// re-exportan desde acá, que es de donde los importa media app.
export {
  datetimeLocalToIso,
  formatFechaHora,
  horaDeDatetimeLocal,
  isoToDatetimeLocal,
  proximaFechaConHora,
  recurrenciaSinFecha,
} from './fechaLocal'
