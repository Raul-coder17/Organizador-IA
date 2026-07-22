import { useEffect } from 'react'
import { useAuth } from './AuthContext'
import { swReadyOrNull } from './push'
import {
  listRecordatoriosParaDisparo,
  marcarEnviado,
  resumenContenido,
} from './recordatorios'
import { reconcileTimers } from './reminderScheduling'
import type { RecordatorioConItem } from '../types/database'

// Cada cuánto sondeamos los recordatorios que vencen pronto. La ventana que
// mira listRecordatoriosParaDisparo (~2 min) es más ancha que este intervalo,
// así ninguno cae entre dos sondeos.
const POLL_MS = 25_000

// setTimeout con delays enormes es poco confiable; como solo armamos timers de
// recordatorios dentro de la ventana (~2 min), esto es un tope defensivo.
const MAX_DELAY_MS = 5 * 60 * 1000

// Watcher del aviso LOCAL de recordatorios: mientras la app está abierta (en
// cualquier pantalla), dispara la notificación en el momento exacto sin
// depender del servidor. Es complementario al cron: como marca 'enviado' apenas
// dispara, el cron del servidor encuentra el recordatorio ya no-pendiente y no
// reenvía. Montar UNA sola vez cerca de la raíz (ver LocalReminderWatcher).
export function useLocalReminderWatcher(): void {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (typeof Notification === 'undefined') return

    let cancelled = false
    // id -> timer armado (con la fecha para la que quedó programado).
    const timers = new Map<string, { timeoutId: number; fechaHora: string }>()
    // ids ya disparados en esta pestaña, para no volver a notificar el mismo
    // recordatorio si un sondeo lo ve pendiente antes de que la DB refleje
    // 'enviado' (evita duplicar en la MISMA pestaña).
    const fired = new Set<string>()

    async function fireReminder(rec: RecordatorioConItem) {
      if (cancelled) return
      if (Notification.permission !== 'granted') return
      const reg = await swReadyOrNull()
      if (!reg || cancelled) return
      // Mismo formato que el push del servidor (send-reminder-notifications):
      // título "Recordatorio", cuerpo = resumen del contenido, url /reminders.
      await reg.showNotification('Recordatorio', {
        body: resumenContenido(rec.item),
        icon: '/icon.svg',
        badge: '/icon.svg',
        data: { url: '/reminders' },
        // tag propio por recordatorio: no colapsa con otro aviso distinto.
        tag: `recordatorio-${rec.id}`,
      })
    }

    async function poll() {
      if (cancelled) return
      // Sin permiso concedido no podemos mostrar nada; no armamos timers.
      if (Notification.permission !== 'granted') return

      let pendientes: RecordatorioConItem[]
      try {
        pendientes = await listRecordatoriosParaDisparo()
      } catch {
        return // best-effort: si falla el sondeo, reintentamos al próximo tick
      }
      if (cancelled) return

      const armed = [...timers.entries()].map(([id, t]) => ({ id, fechaHora: t.fechaHora }))
      const { toArm, toCancel } = reconcileTimers({
        pending: pendientes.map((r) => ({ id: r.id, fecha_hora: r.fecha_hora })),
        armed,
        suppressIds: [...fired],
        now: Date.now(),
      })

      for (const id of toCancel) {
        const t = timers.get(id)
        if (t) {
          clearTimeout(t.timeoutId)
          timers.delete(id)
        }
      }

      const byId = new Map(pendientes.map((r) => [r.id, r]))
      for (const { id, fechaHora, delayMs } of toArm) {
        const rec = byId.get(id)
        if (!rec) continue
        const timeoutId = window.setTimeout(async () => {
          timers.delete(id)
          fired.add(id) // marcamos antes de esperar a la red, para no duplicar
          await fireReminder(rec)
          try {
            await marcarEnviado(id)
          } catch {
            // Si no se pudo marcar 'enviado', el cron del servidor queda como
            // respaldo (encontrará el recordatorio aún pendiente).
          }
        }, Math.min(delayMs, MAX_DELAY_MS))
        timers.set(id, { timeoutId, fechaHora })
      }
    }

    poll()
    const intervalId = window.setInterval(poll, POLL_MS)

    return () => {
      cancelled = true
      clearInterval(intervalId)
      for (const t of timers.values()) clearTimeout(t.timeoutId)
      timers.clear()
    }
  }, [user])
}
