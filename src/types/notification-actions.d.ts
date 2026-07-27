// Los typings DOM/WebWorker que trae esta versión de TypeScript todavía no
// tienen `NotificationAction` ni el campo `actions` de `NotificationOptions`
// (soportados por los navegadores desde hace años — se usan para los botones
// "Posponer 15 min" / "Posponer 1 hora" de la notificación de un recordatorio,
// ver sw.ts y useLocalReminderWatcher.ts). Se completa acá a mano.

export {}

declare global {
  interface NotificationAction {
    action: string
    title: string
    icon?: string
  }

  interface NotificationOptions {
    actions?: NotificationAction[]
  }
}
