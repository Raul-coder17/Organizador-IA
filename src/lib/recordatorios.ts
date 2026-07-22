import { supabase } from './supabase'
import type { Item, Recordatorio, RecordatorioConItem } from '../types/database'

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

// El recordatorio (si existe) asociado a un item, para prellenar el form.
export async function getRecordatorioForItem(itemId: string): Promise<Recordatorio | null> {
  const { data, error } = await supabase
    .from('recordatorios')
    .select('*')
    .eq('item_id', itemId)
    .order('fecha_hora', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

// Crea o actualiza el recordatorio de un item. Como un item tiene a lo sumo un
// recordatorio en esta UI, buscamos el existente y hacemos update, o insert si
// no hay. (No usamos upsert por item_id porque no hay unique constraint ahí.)
export async function upsertRecordatorio(itemId: string, fechaHora: string): Promise<Recordatorio> {
  const existente = await getRecordatorioForItem(itemId)

  if (existente) {
    const { data, error } = await supabase
      .from('recordatorios')
      .update({ fecha_hora: fechaHora, estado: 'pendiente' })
      .eq('id', existente.id)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  const { data, error } = await supabase
    .from('recordatorios')
    .insert({ item_id: itemId, fecha_hora: fechaHora, estado: 'pendiente' })
    .select('*')
    .single()
  if (error) throw error
  return data
}

// Elimina cualquier recordatorio asociado a un item (usado cuando se desmarca el
// toggle en el form).
export async function deleteRecordatoriosForItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('recordatorios').delete().eq('item_id', itemId)
  if (error) throw error
}

export async function marcarHecho(id: string): Promise<Recordatorio> {
  const { data, error } = await supabase
    .from('recordatorios')
    .update({ estado: 'hecho' })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// Cuenta los recordatorios pendientes que están vencidos o vencen hoy (para el
// badge de la nav). El corte es el fin del día local del usuario.
export async function countRecordatoriosPendientesHoy(): Promise<number> {
  const finDeHoy = new Date()
  finDeHoy.setHours(23, 59, 59, 999)

  const { data, error } = await supabase
    .from('recordatorios')
    .select('id, fecha_hora')
    .eq('estado', 'pendiente')
    .lte('fecha_hora', finDeHoy.toISOString())

  if (error) throw error
  return (data ?? []).length
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
