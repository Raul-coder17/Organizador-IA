// Acceso de LECTURA a `recordatorios` en el servidor + helpers de presentación.
// Las mutaciones (crear/editar/borrar, marcar hecho/enviado) pasan por repo.ts
// y las sube sync.ts; ver la nota en items.ts.

import { supabase } from './supabase'
import { leerTabla } from './tabla'
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
  // Una tabla se resume por sus encabezados y cuántas filas tiene: volcar las
  // celdas en una línea no se lee, y desde que el editor guarda {columnas,
  // filas} el fallback de abajo mostraría el jsonb crudo — también en el cuerpo
  // de la notificación local, que sale de acá.
  if (item.tipo === 'tabla') {
    const tabla = leerTabla(c)
    if (tabla) {
      const cabeceras = (tabla.headers ?? []).map((h) => h.trim()).filter(Boolean).join(' · ')
      const filas = `${tabla.rows.length} fila${tabla.rows.length === 1 ? '' : 's'}`
      return cabeceras ? `${cabeceras} (${filas})` : filas
    }
  }
  if (typeof c.texto === 'string' && c.texto.trim()) return c.texto.trim()
  return JSON.stringify(c)
}
