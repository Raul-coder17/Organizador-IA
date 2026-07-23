import { useEffect } from 'react'
import { useAuth } from '../lib/AuthContext'
import { startSyncEngine } from '../lib/sync'

// Monta el motor de sincronización mientras haya sesión: engancha los
// disparadores (online / foco / visibilidad / intervalo), hace el primer sync
// al arrancar y lo desengancha al cerrar sesión. Va UNA sola vez cerca de la
// raíz (igual que LocalReminderWatcher). No renderiza nada.
export function SyncEngine() {
  const { user } = useAuth()

  useEffect(() => {
    if (!user) return
    return startSyncEngine(user.id)
  }, [user])

  return null
}
