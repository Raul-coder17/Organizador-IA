import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useAiEnabled } from '../lib/useAiEnabled'
import { useRecordatoriosBadge } from '../lib/useRecordatoriosBadge'
import { supabase } from '../lib/supabase'

export function AppNav() {
  const { user } = useAuth()
  const aiEnabled = useAiEnabled()
  const recordatoriosPendientes = useRecordatoriosBadge()
  const location = useLocation()

  const linkClass = (path: string) =>
    `nav-link${location.pathname === path ? ' nav-link--active' : ''}`

  return (
    <header className="app-nav">
      <div className="app-nav__left">
        <span className="app-brand">Organizador Personal IA</span>
        <nav className="nav-links">
          <Link to="/" className={linkClass('/')}>
            Items
          </Link>
          <Link to="/reminders" className={linkClass('/reminders')}>
            Recordatorios
            {recordatoriosPendientes > 0 && (
              <span className="nav-badge">{recordatoriosPendientes}</span>
            )}
          </Link>
          {aiEnabled ? (
            <Link to="/assistant" className={linkClass('/assistant')}>
              Asistente
            </Link>
          ) : (
            <Link
              to="/settings"
              title="Activá la IA en Settings para usar el asistente"
              className="nav-link nav-link--disabled"
            >
              Asistente
            </Link>
          )}
          <Link to="/settings" className={linkClass('/settings')}>
            Settings
          </Link>
        </nav>
      </div>
      <div className="app-nav__right">
        <span className="app-nav__email">{user?.email}</span>
        <button onClick={() => supabase.auth.signOut()} className="link-underline">
          Cerrar sesión
        </button>
      </div>
    </header>
  )
}
