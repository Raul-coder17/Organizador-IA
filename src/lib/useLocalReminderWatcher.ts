import { useEffect } from 'react'
import { useAuth } from './AuthContext'
import { swReadyOrNull } from './push'
import { resumenContenido } from './recordatorios'
import { listRecordatoriosParaDisparo, marcarEnviado } from './repo'
import { reconcileTimers, splitStaleReminders } from './reminderScheduling'
import type { Recordatorio, RecordatorioConItem } from '../types/database'

// Cada cuánto sondeamos los recordatorios que vencen pronto. La ventana que
// mira listRecordatoriosParaDisparo (~2 min) es más ancha que este intervalo,
// así ninguno cae entre dos sondeos.
const POLL_MS = 25_000

// setTimeout con delays enormes es poco confiable; como solo armamos timers de
// recordatorios dentro de la ventana (~2 min), esto es un tope defensivo.
const MAX_DELAY_MS = 5 * 60 * 1000

// Un recordatorio que venció hace más que esto no puede haber vencido "recién"
// con la app abierta: o la app estuvo cerrada, o el dispositivo dormido. Esos
// van al aviso agregado de catch-up en vez de dispararse de a uno con fecha
// vieja. El margen cubre holgadamente el intervalo de sondeo.
const GRACIA_CATCHUP_MS = 2 * 60 * 1000

// Watcher del aviso LOCAL de recordatorios: mientras la app está abierta (en
// cualquier pantalla), dispara la notificación en el momento exacto sin
// depender del servidor.
//
// Lee del ESPEJO LOCAL (IndexedDB), no de la red: por eso sigue avisando sin
// conexión (PLAN_OFFLINE.md §6.2). El 'enviado' que marca al disparar pasa por
// el repositorio, así que sin señal queda encolado en el outbox y sube al
// reconectar. Ese 'enviado' es también lo que evita que el cron del servidor
// reenvíe lo mismo. Montar UNA sola vez cerca de la raíz (ver
// LocalReminderWatcher).
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

    // Un recordatorio RECURRENTE no termina cuando se marca 'enviado': vuelve a
    // 'pendiente' con la fecha de su próxima vuelta. Si lo dejáramos en `fired`,
    // el supresor de reconcileTimers le impediría armar el timer del ciclo
    // siguiente mientras esta pestaña siguiera abierta — un "todos los días a
    // las 9" avisaría una sola vez y nunca más hasta recargar.
    //
    // Se reconoce por el estado que devuelve marcarEnviado: si volvió a quedar
    // 'pendiente', reenganchó. Un no recurrente queda 'enviado' y sigue
    // suprimido como siempre.
    function desuprimirSiReenganchó(id: string, resultado: Recordatorio | null) {
      if (resultado?.estado === 'pendiente') fired.delete(id)
    }

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

    // Un solo aviso por todo lo que venció mientras la app estaba cerrada o sin
    // señal, en vez de una ráfaga de notificaciones con fecha vieja.
    async function fireCatchUp(cantidad: number) {
      if (cancelled) return
      if (Notification.permission !== 'granted') return
      const reg = await swReadyOrNull()
      if (!reg || cancelled) return
      await reg.showNotification('Recordatorios vencidos', {
        body:
          cantidad === 1
            ? 'Tenías 1 recordatorio vencido.'
            : `Tenías ${cantidad} recordatorios vencidos.`,
        icon: '/icon.svg',
        badge: '/icon.svg',
        data: { url: '/reminders' },
        // tag fijo: si se acumulan varios catch-up, se reemplazan en vez de
        // apilarse.
        tag: 'recordatorios-catchup',
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

      // Primero apartamos los vencidos viejos: no se avisan de a uno.
      const { fresh, stale } = splitStaleReminders({
        pending: pendientes.map((r) => ({ id: r.id, fecha_hora: r.fecha_hora })),
        suppressIds: [...fired],
        now: Date.now(),
        graceMs: GRACIA_CATCHUP_MS,
      })

      if (stale.length > 0) {
        // Marcamos antes de esperar a la red para no reavisar en el próximo
        // sondeo (mismo criterio que el disparo individual).
        for (const s of stale) fired.add(s.id)
        await fireCatchUp(stale.length)
        if (cancelled) return
        for (const s of stale) {
          try {
            // 'enviado' local + encolado: en /reminders siguen viéndose como
            // vencidos (estado 'enviado' no es 'hecho') y el cron del servidor
            // ya no los reenvía.
            desuprimirSiReenganchó(s.id, await marcarEnviado(s.id))
          } catch {
            /* si no se pudo escribir local, el próximo sondeo reintenta */
          }
        }
      }

      const armed = [...timers.entries()].map(([id, t]) => ({ id, fechaHora: t.fechaHora }))
      const { toArm, toCancel } = reconcileTimers({
        pending: fresh,
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
            // Marca local + encolado: si no hay red, el 'enviado' sube solo al
            // reconectar en vez de perderse.
            desuprimirSiReenganchó(id, await marcarEnviado(id))
          } catch {
            // Si ni siquiera se pudo escribir local, el cron del servidor queda
            // como respaldo (encontrará el recordatorio aún pendiente).
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
