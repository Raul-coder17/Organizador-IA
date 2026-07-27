import { useEffect } from 'react'
import { useAuth } from '../lib/AuthContext'
import { getMeta } from '../lib/db'
import {
  cancelPendingSync,
  noteLastSyncAt,
  noteOffline,
  noteOnline,
  refreshOnlineState,
  refreshPending,
  RETRY_MS,
  setSyncUser,
  syncNow,
} from '../lib/sync'

// Monta el motor de sincronización mientras haya sesión: engancha los
// disparadores (online / foco / visibilidad / intervalo), hace el primer sync
// al arrancar y lo desengancha al cerrar sesión. Va UNA sola vez cerca de la
// raíz (igual que LocalReminderWatcher). No renderiza nada.
//
// El enganche de `window`/`document` vive ACÁ y no en sync.ts: ese archivo
// también lo importa el service worker (sw.ts, para posponer un recordatorio
// desde la notificación por el mismo camino offline-first — ver
// repo.ts::posponerRecordatorio), donde esas APIs no existen.
export function SyncEngine() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return
    setSyncUser(user.id)

    const onOnline = () => noteOnline()
    const onOffline = () => noteOffline()
    const onFocus = () => void syncNow()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void syncNow()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    const intervalId = window.setInterval(() => void syncNow(), RETRY_MS)

    // Estado inicial del indicador: conexión, pendientes en cola y la última
    // sincronización que quedó guardada de la sesión anterior.
    refreshOnlineState()
    void refreshPending()
    void getMeta<string>('lastSyncAt').then((ts) => noteLastSyncAt(ts))

    void syncNow()

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(intervalId)
      cancelPendingSync()
      setSyncUser(null)
    }
  }, [user])

  return null
}
