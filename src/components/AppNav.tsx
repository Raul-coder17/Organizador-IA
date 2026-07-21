import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

export function AppNav() {
  const { user } = useAuth()
  const location = useLocation()

  const linkClass = (path: string) =>
    location.pathname === path ? 'font-medium text-slate-800' : 'text-slate-500 hover:text-slate-800'

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <h1 className="text-lg font-semibold text-slate-800">Organizador Personal IA</h1>
        <nav className="flex items-center gap-4 text-sm">
          <Link to="/" className={linkClass('/')}>
            Items
          </Link>
          <Link to="/settings" className={linkClass('/settings')}>
            Settings
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-500">{user?.email}</span>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-slate-500 hover:text-slate-700 underline"
        >
          Cerrar sesión
        </button>
      </div>
    </header>
  )
}
