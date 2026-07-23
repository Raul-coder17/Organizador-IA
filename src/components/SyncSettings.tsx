import { useEffect, useState } from 'react'
import { useSyncStatus } from '../lib/useSyncStatus'
import { formatHaceCuanto } from '../lib/syncCore'
import { forceSyncNow } from '../lib/sync'

// Detalle del estado de sincronización, para diagnóstico. El indicador de la
// nav es el aviso rápido; acá está el panorama completo y el botón para forzar
// un ciclo sin esperar al reintento automático.
export function SyncSettings() {
  const { online, running, pending, lastSyncAt, error } = useSyncStatus()
  // "hace 2 min" tiene que envejecer solo aunque no cambie nada más.
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="space-y-6">
      <h2 className="font-fraunces text-[19px] font-medium text-ink">Sincronización</h2>

      <div className="bg-card border border-line rounded-[2px] p-5 space-y-4">
        <p className="text-sm text-ink-soft">
          Conexión:{' '}
          {online ? (
            <span className="font-mono uppercase tracking-wide text-moss">En línea</span>
          ) : (
            <span className="font-mono uppercase tracking-wide text-slate">Sin conexión</span>
          )}
        </p>

        <p className="text-sm text-ink-soft">
          Cambios pendientes:{' '}
          <span className={`font-mono ${pending > 0 ? 'text-gold' : 'text-ink'}`}>{pending}</span>
        </p>

        <p className="text-sm text-ink-soft">
          Última sincronización:{' '}
          <span className="font-mono text-ink">{formatHaceCuanto(lastSyncAt, ahora)}</span>
        </p>

        {error && <p className="text-sm text-rust">{error}</p>}

        <button onClick={() => forceSyncNow()} disabled={!online || running} className="btn-moss">
          {running ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
      </div>

      <p className="text-xs text-slate">
        Tus items, temas y recordatorios se guardan en este dispositivo apenas los tocás, con o sin
        conexión. Lo que hagas sin señal queda en cola y sube solo cuando vuelva.
      </p>
    </div>
  )
}
