/// <reference lib="webworker" />
//
// Service worker propio (estrategia injectManifest de vite-plugin-pwa).
// Además del precache de Workbox, maneja las notificaciones Web Push que
// dispara la Edge Function `send-reminder-notifications`.

import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[]
}

// Punto de inyección del manifiesto de precache (lo completa el build).
precacheAndRoute(self.__WB_MANIFEST)

// Toma control cuanto antes para que la app recién cargada ya tenga SW activo.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

interface PushPayload {
  title?: string
  body?: string
  url?: string
}

// Notificación push: el payload viene como JSON desde la Edge Function con
// { title, body, url }. Si no se puede parsear, mostramos un texto genérico.
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

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url },
      tag: 'recordatorio',
    }),
  )
})

// Click en la notificación: enfoca una pestaña abierta de la app (navegándola a
// /reminders) o abre una nueva.
self.addEventListener('notificationclick', (event) => {
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
