import { useSyncStatus } from '../lib/useSyncStatus'
import { formatHaceCuanto } from '../lib/syncCore'

// Indicador de conexión y sincronización para la nav (PLAN_OFFLINE.md ítem 7).
//
// Solo aparece cuando tiene algo que decir: sin conexión, con cambios en cola o
// con un error. Cuando todo está al día no dibuja nada, para no meter ruido
// permanente en la barra (el detalle completo vive en Settings › Sincronización).
export function SyncStatus() {
  const { online, running, pending, lastSyncAt, error } = useSyncStatus()

  // Todo en orden y nada en cola: nada que mostrar.
  if (online && !error && pending === 0) return null

  // "Sincronizando…" solo cuando de verdad estamos subiendo algo. El re-fetch
  // periódico con la cola vacía es invisible a propósito: si no, el indicador
  // parpadearía cada 30 segundos sin que pase nada interesante.
  const subiendo = running && pending > 0

  let estado: 'offline' | 'error' | 'sync' | 'pending'
  let etiqueta = ''

  if (!online) {
    estado = 'offline'
    etiqueta = 'Sin conexión'
  } else if (error) {
    estado = 'error'
    etiqueta = error
  } else if (subiendo) {
    estado = 'sync'
    etiqueta = 'Sincronizando…'
  } else {
    estado = 'pending'
  }

  // Mientras sube, el conteo ya lo dice "Sincronizando…"; en el resto de los
  // casos el número es la información principal.
  const contador = pending > 0 && estado !== 'sync' ? `${pending} sin sincronizar` : null

  return (
    <span
      className={`sync-status sync-status--${estado}`}
      role="status"
      title={`Última sincronización: ${formatHaceCuanto(lastSyncAt, Date.now())}`}
    >
      <span className="sync-status__dot" aria-hidden="true" />
      {etiqueta && <span>{etiqueta}</span>}
      {contador && (
        <span className="sync-status__count">
          {etiqueta ? '· ' : ''}
          {contador}
        </span>
      )}
    </span>
  )
}
