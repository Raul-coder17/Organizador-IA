import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushStatus =
  | 'unsupported' // el navegador no soporta push/notificaciones
  | 'default' // soportado, todavía sin decidir
  | 'granted' // permiso concedido
  | 'denied' // permiso rechazado por el usuario
  | 'subscribed' // permiso concedido y suscripción guardada

// ¿El navegador soporta lo necesario para Web Push?
export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// `navigator.serviceWorker.ready` NO rechaza si no hay un SW activo: cuelga
// para siempre. Lo carreamos contra un timeout para no bloquear nunca la UI.
// Si vence el timeout, resolvemos a null y el llamador decide qué hacer.
const SW_READY_TIMEOUT_MS = 6000

async function swReadyOrNull(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)),
  ])
}

// Estado actual: combina el permiso de Notification con si ya hay una
// suscripción activa en el service worker.
export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission === 'default') return 'default'

  // granted: chequeamos si además hay una suscripción viva. Si el SW no está
  // listo (timeout), no colgamos: reportamos 'granted' (permiso ok, sin
  // suscripción confirmada) para que la UI muestre el botón de activar.
  try {
    const reg = await swReadyOrNull()
    if (!reg) return 'granted'
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'subscribed' : 'granted'
  } catch {
    return 'granted'
  }
}

// Convierte la VAPID public key (base64url) al Uint8Array que espera
// pushManager.subscribe como applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

// Extrae p256dh/auth de una PushSubscription del navegador como base64url.
function keyToBase64(sub: PushSubscription, name: PushEncryptionKeyName): string {
  const key = sub.getKey(name)
  if (!key) return ''
  const bytes = new Uint8Array(key)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Pide permiso, se suscribe vía el service worker y guarda la suscripción en
// push_subscriptions (upsert por endpoint). Devuelve el nuevo estado.
export async function subscribeToPush(userId: string): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('Falta VITE_VAPID_PUBLIC_KEY en la configuración.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return permission === 'denied' ? 'denied' : 'default'
  }

  const reg = await swReadyOrNull()
  if (!reg) {
    throw new Error(
      'El service worker no está listo. Recargá la página e intentá de nuevo.',
    )
  }

  // Reusa la suscripción existente o crea una nueva.
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: keyToBase64(sub, 'p256dh'),
      auth: keyToBase64(sub, 'auth'),
    },
    { onConflict: 'endpoint' },
  )

  if (error) throw error
  return 'subscribed'
}

// Da de baja la suscripción de este navegador (opcional): la borra localmente y
// de push_subscriptions.
export async function unsubscribeFromPush(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  const reg = await swReadyOrNull()
  if (!reg) return getPushStatus()
  const sub = await reg.pushManager.getSubscription()
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    await sub.unsubscribe()
  }
  return getPushStatus()
}
