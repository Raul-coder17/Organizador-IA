import type { ReactNode } from 'react'
import { useAuth } from '../lib/AuthContext'
import { AuthPage } from '../pages/AuthPage'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

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
