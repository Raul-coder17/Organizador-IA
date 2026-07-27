/// <reference lib="webworker" />
//
// Service worker propio (estrategia injectManifest de vite-plugin-pwa).
// Además del precache de Workbox, maneja las notificaciones Web Push que
// dispara la Edge Function `send-reminder-notifications`.

import { precacheAndRoute } from 'workbox-precaching'
import { ACCIONES_POSPONER } from './lib/notificacionRecordatorio'
import { posponerRecordatorio } from './lib/repo'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[]
}

// Punto de inyección del manifiesto de precache (lo completa el build).
precacheAndRoute(self.__WB_MANIFEST)

// Toma control cuanto antes para que la app recién cargada ya tenga SW activo.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// No hay skipWaiting() automático en 'install': con registerType 'prompt' el SW
// nuevo se queda a propósito en estado "esperando" hasta que la UI (ver
// UpdateBanner.tsx) avise al usuario y este confirme. Recién ahí
// virtual:pwa-register/react manda este mensaje para pasar a 'activate' sin
// tener que cerrar todas las pestañas.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
  recordatorioId?: string
}

// Minutos que pospone cada acción, por su `action` id (ver ACCIONES_POSPONER en
// lib/recordatorios.ts, que define el mismo array para el aviso local).
const MINUTOS_POR_ACCION: Record<string, number> = Object.fromEntries(
  ACCIONES_POSPONER.map((a) => [a.action, a.minutos]),
)

// Notificación push: el payload viene como JSON desde la Edge Function con
// { title, body, url, tag, recordatorioId }. Si no se puede parsear, mostramos
// un texto genérico.
self.addEventListener('push', (event) => {
  let payload: PushPayload = {}
  try {
    payload = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    payload = { body: event.data?.text() }
  }

  const title = payload.title ?? 'Recordatorio'
  const body = payload.body ?? 'Tenés un recordatorio pendiente.'
  const url = payload.url ?? '/reminders'
  // El cron manda `recordatorio-<id>`, el mismo tag que usa el aviso local del
  // watcher. Así, si los dos avisan por el mismo recordatorio (el 'enviado' del
  // watcher todavía no había subido porque el dispositivo estaba sin señal), el
  // push REEMPLAZA la notificación local en vez de apilar una segunda.
  // Fallback al tag viejo por si llega un push anterior a este cambio.
  const tag = payload.tag ?? 'recordatorio'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon.svg',
      badge: '/badge.svg',
      data: { url, recordatorioId: payload.recordatorioId },
      tag,
      // Sólo tiene sentido posponer un recordatorio puntual: si el payload es
      // viejo (sin recordatorioId, de antes de este cambio) no se ofrecen
      // botones que notificationclick no podría resolver.
      actions: payload.recordatorioId ? [...ACCIONES_POSPONER] : undefined,
    }),
  )
})

// Click en la notificación.
//
// Si fue un botón de "Posponer": reprograma el recordatorio (mismo mecanismo
// offline-first que el resto de la app — repo.ts / el motor de sync, así que
// funciona igual sin conexión) y listo, SIN abrir la app.
//
// Si fue el cuerpo de la notificación: enfoca una pestaña abierta de la app
// (navegándola a /reminders) o abre una nueva, como siempre.
self.addEventListener('notificationclick', (event) => {
  const recordatorioId = event.notification.data?.recordatorioId as string | undefined
  const minutos = event.action ? MINUTOS_POR_ACCION[event.action] : undefined

  if (minutos !== undefined && recordatorioId) {
    event.notification.close()
    event.waitUntil(posponerRecordatorio(recordatorioId, minutos).catch(() => {}))
    return
  }

  event.notification.close()
  const targetUrl = (event.notification.data?.url as string) ?? '/reminders'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
