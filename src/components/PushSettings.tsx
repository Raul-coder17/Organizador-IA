import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import {
  getPushStatus,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  type PushStatus,
} from '../lib/push'

export function PushSettings() {
  const { user } = useAuth()
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getPushStatus()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {
        // Ante cualquier rechazo inesperado, salimos de "Cargando…" igual:
        // asumimos 'default' (soportado, sin decidir) y mostramos el error.
        if (cancelled) return
        setStatus('default')
        setError('No se pudo leer el estado de las notificaciones.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleActivar() {
    if (!user) return
    setWorking(true)
    setError(null)
    try {
      setStatus(await subscribeToPush(user.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron activar las notificaciones.')
    } finally {
      setWorking(false)
    }
  }

  async function handleDesactivar() {
    setWorking(true)
    setError(null)
    try {
      setStatus(await unsubscribeFromPush())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron desactivar las notificaciones.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="font-fraunces text-[19px] font-medium text-ink">Notificaciones</h2>

      <div className="bg-card border border-line rounded-[2px] p-5 space-y-4">
        {status === null ? (
          <p className="text-sm text-ink-soft">Cargando…</p>
        ) : status === 'unsupported' ? (
          <p className="text-sm text-ink-soft">
            Este navegador no soporta notificaciones push. Probá desde Chrome/Edge/Firefox de
            escritorio o Android (en iOS, la app tiene que estar instalada como PWA).
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-soft">
              Estado:{' '}
              {status === 'subscribed' ? (
                <span className="font-mono uppercase tracking-wide text-moss">Activadas</span>
              ) : status === 'denied' ? (
                <span className="font-mono uppercase tracking-wide text-rust">Rechazadas</span>
              ) : (
                <span className="font-mono uppercase tracking-wide text-slate">Inactivas</span>
              )}
            </p>

            {status === 'denied' ? (
              <p className="text-sm text-ink-soft">
                Bloqueaste las notificaciones para este sitio. Habilitalas desde la configuración del
                navegador (candado en la barra de direcciones → Notificaciones) y recargá.
              </p>
            ) : status === 'subscribed' ? (
              <button onClick={handleDesactivar} disabled={working} className="btn-outline">
                {working ? 'Procesando…' : 'Desactivar en este dispositivo'}
              </button>
            ) : (
              <button onClick={handleActivar} disabled={working} className="btn-moss">
                {working ? 'Activando…' : 'Activar notificaciones push'}
              </button>
            )}

            {error && <p className="text-sm text-rust">{error}</p>}
          </>
        )}
      </div>

      <p className="text-xs text-slate">
        Te avisamos cuando un recordatorio llega a su fecha. La suscripción es por navegador/
        dispositivo: activala en cada uno donde quieras recibir avisos.
      </p>
    </div>
  )
}

// Reexport útil por si el padre quiere condicionar algo al soporte.
export { isPushSupported }
