import { useSyncExternalStore } from 'react'
import { getSyncState, subscribeSync, type SyncState } from './sync'

// Estado del motor de sincronización, listo para pintar. `getSyncState`
// devuelve siempre la MISMA referencia mientras nada cambie, así que React
// descarta solo los avisos que no mueven nada.
export function useSyncStatus(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState)
}
