import { useEffect, type ReactNode } from 'react'
import { useAuth } from '../lib/AuthContext'
import { ensurePersistentStorage } from '../lib/persistentStorage'
import { AuthPage } from '../pages/AuthPage'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  // Al haber sesión, pedimos almacenamiento persistente para que IndexedDB (la
  // caché offline y el outbox futuro) no sea desalojado. Best-effort: si se
  // deniega o no está soportado, no pasa nada (PLAN_OFFLINE.md ítem 10).
  useEffect(() => {
    if (session) ensurePersistentStorage()
  }, [session])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500">Cargando…</p>
      </div>
    )
  }

  if (!session) {
    return <AuthPage />
  }

  return <>{children}</>
}
