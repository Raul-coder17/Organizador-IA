// Acceso de LECTURA a `recordatorios` en el servidor + helpers de presentación.
// Las mutaciones (crear/editar/borrar, marcar hecho/enviado) pasan por repo.ts
// y las sube sync.ts; ver la nota en items.ts.

import { supabase } from './supabase'
import type { Item, Recordatorio, RecordatorioConItem } from '../types/database'

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

// Ventana (ms) hacia adelante que mira el watcher local: recordatorios que
// vencen dentro de los próximos ~2 min (o ya vencidos) son candidatos a armar
// un timer local. Igualarla al intervalo de sondeo + margen alcanza para no
// perder ninguno entre dos sondeos.
const VENTANA_DISPARO_MS = 2 * 60 * 1000

// Recordatorios propios en estado 'pendiente' que vencen pronto (dentro de la
// ventana) o ya vencieron, con el item embebido para armar el cuerpo de la
// notificación local. Lo usa useLocalReminderWatcher. La RLS ya restringe a los
// del usuario (igual que listRecordatorios).
export async function listRecordatoriosParaDisparo(): Promise<RecordatorioConItem[]> {
  const limite = new Date(Date.now() + VENTANA_DISPARO_MS).toISOString()
  const { data, error } = await supabase
    .from('recordatorios')
    .select(`*, item:items(${ITEM_COLS})`)
    .eq('estado', 'pendiente')
    .lte('fecha_hora', limite)
    .order('fecha_hora', { ascending: true })

  if (error) throw error
  return (data ?? []) as unknown as RecordatorioConItem[]
}

// --- Helpers de fecha/hora --------------------------------------------------

// Convierte un ISO (UTC, como lo guarda Postgres) al formato que espera un
// <input type="datetime-local"> ("YYYY-MM-DDTHH:mm"), en hora local.
export function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Convierte el valor de un datetime-local (hora local, sin zona) a ISO UTC.
export function datetimeLocalToIso(value: string): string {
  return new Date(value).toISOString()
}

// Formato legible para mostrar la fecha/hora de un recordatorio.
export function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Resumen textual del contenido de un item, para mostrarlo en la lista de
// recordatorios sin depender del render completo de ItemList.
export function resumenContenido(item: Pick<Item, 'tipo' | 'contenido'> | null): string {
  if (!item) return 'Item eliminado'
  const c = item.contenido ?? {}
  if (item.tipo === 'lista' && Array.isArray(c.items)) {
    const lineas = c.items as { texto?: unknown }[]
    const total = lineas.length
    const preview = lineas
      .slice(0, 3)
      .map((l) => String(l.texto ?? ''))
      .filter(Boolean)
      .join(', ')
    return total > 3 ? `${preview}… (${total} líneas)` : preview || 'Lista vacía'
  }
  if (typeof c.texto === 'string' && c.texto.trim()) return c.texto.trim()
  return JSON.stringify(c)
}
