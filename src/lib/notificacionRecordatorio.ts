// Contenido de la notificación de un recordatorio (aviso local y push del
// servidor) + el resumen del contenido de un item que usa como título.
//
// Vive en su propio archivo, separado de recordatorios.ts, para poder
// testearlo con `deno test` sin arrastrar Supabase: recordatorios.ts importa
// `./supabase` (para listRecordatorios) y ese módulo lee `import.meta.env`,
// que no existe corriendo bajo Deno — el mismo motivo por el que
// reminderScheduling.ts está separado de useLocalReminderWatcher.ts.

import { leerTabla } from './tabla'
import { marcaRecurrencia } from './recurrencia'
import type { Item, Recordatorio } from '../types/database'

// Resumen textual del contenido de un item, para mostrarlo en la lista de
// recordatorios (sin depender del render completo de ItemList) y como título
// de su notificación.
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

export interface ContenidoNotificacion {
  title: string
  body: string
}

// Título/cuerpo de la notificación de un recordatorio (aviso local Y push del
// servidor: ver el gemelo en supabase/functions/send-reminder-notifications,
// que arma lo mismo del lado del cron).
//
// Título = el contenido del item ("Tomar la pastilla"), no un genérico
// "Recordatorio": es lo primero que se lee y lo que de verdad importa. Cuerpo =
// contexto breve — el tema, y si se repite, sin ocupar más de una línea corta
// (el espacio de una notificación es limitado, así que no se listan los dos
// puntos si no hay nada que decir en ninguno).
export function contenidoNotificacion(
  rec: Pick<Recordatorio, 'fecha_hora' | 'recurrencia' | 'recurrencia_dias'>,
  item: Pick<Item, 'tipo' | 'contenido'> | null,
  temaNombre: string | null,
): ContenidoNotificacion {
  const repite = marcaRecurrencia(rec)
  const contexto = [temaNombre, repite ? `Se repite: ${repite.corta}` : null].filter(
    (parte): parte is string => Boolean(parte),
  )
  return {
    title: resumenContenido(item),
    body: contexto.length > 0 ? contexto.join(' · ') : 'Tenés un recordatorio pendiente.',
  }
}

// Acciones de "posponer" de la notificación de un recordatorio (aviso local y
// push). Dos nomás: es lo máximo que los navegadores soportan mostrar de forma
// confiable sin recortarlas en un menú. Los `action` viajan tal cual a
// `event.action` en el `notificationclick` del service worker (ver sw.ts), que
// es quien interpreta `minutos`.
export const ACCIONES_POSPONER = [
  { action: 'posponer-15', title: 'Posponer 15 min', minutos: 15 },
  { action: 'posponer-60', title: 'Posponer 1 hora', minutos: 60 },
] as const
