import { useEffect, useState, type ReactElement } from 'react'
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useAiEnabled } from '../lib/useAiEnabled'
import { useRecordatoriosBadge } from '../lib/useRecordatoriosBadge'
import { useIsWide } from '../lib/useIsWide'
import { setTheme, useTheme } from '../lib/theme'
import { supabase } from '../lib/supabase'
import { SyncStatus } from './SyncStatus'

// Chasis de la app (PLAN_REDISEÑO.md ítem 7). Reemplaza a AppNav.
//
//   ≥900px  sidebar de 264px: marca, buscador, nav vertical, "+ Nuevo item",
//           asistente y bloque de cuenta al pie.
//   <900px  barra superior sticky (marca + sync + tema + buscador), tab bar
//           inferior de 5 celdas con el "+" al medio, y FAB del asistente.
//
// Se monta como layout route: las páginas siguen siendo las de siempre y sólo
// aportan su <main class="shell-main">. Conservamos react-router (decisión D1),
// así que el destino activo se lee de la URL y no de un estado de UI.
//
// DÓNDE VA EL INDICADOR DE SYNC (§3.3-C, el punto abierto del plan):
//   · ancho   → en el bloque de cuenta del sidebar, bajo el email, que es donde
//               el prototipo dibuja "EN LÍNEA · SYNC OK".
//   · angosto → en la barra superior, entre la marca y el toggle de tema.
// La alternativa era mandarlo a Ajustes, y era una regresión: en una app
// offline-first "no se está guardando en el servidor" tiene que verse sin
// buscarlo. La barra superior es sticky, así que ahora se ve *más* que antes
// (la nav vieja se iba con el scroll). Y como SyncStatus no dibuja nada cuando
// todo está al día, en el caso normal no ocupa lugar en ninguno de los dos.

const TRAZO = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  viewBox: '0 0 24 24',
} as const

function IconoHoy({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...TRAZO} aria-hidden="true">
      <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </svg>
  )
}

function IconoBiblioteca({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...TRAZO} aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h11" />
    </svg>
  )
}

function IconoRecordatorios({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...TRAZO} aria-hidden="true">
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}

function IconoAjustes({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...TRAZO} aria-hidden="true">
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="14" cy="7" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </svg>
  )
}

function IconoBuscar() {
  return (
    <svg width="16" height="16" {...TRAZO} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  )
}

function IconoMas({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...TRAZO} strokeWidth={2} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function IconoChispa({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...TRAZO} strokeWidth={1.6} aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" />
    </svg>
  )
}

function IconoSol() {
  return (
    <svg width="16" height="16" {...TRAZO} aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" />
    </svg>
  )
}

function IconoLuna() {
  return (
    <svg width="16" height="16" {...TRAZO} aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  )
}

type Destino = {
  to: string
  label: string
  corto: string
  Icono: (props: { size?: number }) => ReactElement
  badge?: boolean
}

// "Hoy" apunta a "/" provisoriamente: la vista no existe todavía (ítem 8), y
// hasta entonces "/" sigue mostrando la Biblioteca. Por eso la Biblioteca ya
// tiene su ruta propia — si los dos destinos apuntaran a "/", los dos se
// marcarían activos a la vez. En el ítem 8, "/" pasa a ser la vista Hoy y acá
// no hay nada que tocar.
const DESTINOS: Destino[] = [
  { to: '/', label: 'Hoy', corto: 'Hoy', Icono: IconoHoy },
  { to: '/biblioteca', label: 'Biblioteca', corto: 'Biblio', Icono: IconoBiblioteca },
  {
    to: '/reminders',
    label: 'Recordatorios',
    corto: 'Recor',
    Icono: IconoRecordatorios,
    badge: true,
  },
  { to: '/settings', label: 'Ajustes', corto: 'Ajustes', Icono: IconoAjustes },
]

// El destino del "+": hasta el ítem 11 el formulario sigue siendo el de la
// Biblioteca, así que lo abrimos desde acá con estado de navegación en vez de
// dejar el botón principal del shell sin hacer nada.
const NUEVO_ITEM = { to: '/biblioteca', state: { nuevoItem: true } }

// Buscador global (ítem 9). Vive en el shell, pero no dibuja resultados: al
// escribir navega a la Biblioteca con la consulta en la URL (`/biblioteca?q=…`)
// y es ItemsPage la que filtra y agrupa. Así se reusa tal cual el layout de
// grupos por tema y el estado vacío, en vez de inventar una pantalla de
// resultados nueva (§ítem 9, decisión de presentación).
//
// El input es la fuente de verdad de lo que se ve tipeado; la URL se actualiza
// con un respiro (debounce) para no navegar en cada tecla. `replace: true`
// mantiene el historial limpio: tipear no deja un rastro de estados intermedios
// para el botón "atrás".
const DEBOUNCE_MS = 250

function Buscador({ id }: { id: string }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const enBiblioteca = location.pathname === '/biblioteca'
  const qUrl = enBiblioteca ? (searchParams.get('q') ?? '') : ''

  const [valor, setValor] = useState(qUrl)

  // Si la URL cambia por fuera del input (navegación, limpiar el filtro, o
  // llegar directo a un link con ?q=…), el input se pone al día. No pisa lo que
  // el usuario está tipeando: tras el debounce `valor` y `qUrl` coinciden, así
  // que este efecto sólo actúa ante un cambio externo real.
  useEffect(() => {
    setValor(qUrl)
  }, [qUrl])

  // Debounce: al frenar de tipear, se refleja en la URL. Ir a la Biblioteca con
  // consulta vacía = mostrarla sin filtro de texto (los demás filtros siguen).
  useEffect(() => {
    if (valor === qUrl) return
    const t = setTimeout(() => {
      const destino = valor.trim() ? `/biblioteca?q=${encodeURIComponent(valor.trim())}` : '/biblioteca'
      navigate(destino, { replace: enBiblioteca })
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [valor, qUrl, enBiblioteca, navigate])

  return (
    <div className="shell-search">
      <span className="shell-search__icon">
        <IconoBuscar />
      </span>
      <label className="sr-only" htmlFor={id}>
        Buscar en la biblioteca
      </label>
      <input
        id={id}
        type="search"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="Buscar en todo…"
        className="shell-search__input"
      />
    </div>
  )
}

export function AppShell() {
  const { user } = useAuth()
  const aiEnabled = useAiEnabled()
  const recordatoriosPendientes = useRecordatoriosBadge()
  const location = useLocation()
  const wide = useIsWide()
  const theme = useTheme()

  const esActivo = (to: string) => location.pathname === to

  // Mismo criterio que la nav vieja: mientras `useAiEnabled` carga (null) el
  // asistente se muestra apagado, y apagado significa "te llevo a Ajustes",
  // no "no hago nada".
  const asistenteActivo = aiEnabled === true
  const asistenteTo = asistenteActivo ? '/assistant' : '/settings'
  const asistenteTitulo = asistenteActivo
    ? 'Asistente IA'
    : 'Activá la IA en Ajustes para usar el asistente'

  const temaSiguiente = theme === 'dark' ? 'light' : 'dark'
  const iniciales = (user?.email ?? '?').slice(0, 2).toUpperCase()

  const celda = ({ to, corto, Icono, badge }: Destino) => (
    <Link
      key={to}
      to={to}
      aria-current={esActivo(to) ? 'page' : undefined}
      className={`tabbar__item${esActivo(to) ? ' tabbar__item--active' : ''}`}
    >
      <span className="tabbar__icon">
        <Icono size={22} />
        {badge && recordatoriosPendientes > 0 && (
          <span className="tab-badge">{recordatoriosPendientes}</span>
        )}
      </span>
      <span className="tabbar__label">{corto}</span>
    </Link>
  )

  return (
    <div className="shell">
      {wide && (
        <aside className="shell__sidebar">
          <span className="app-brand">Organizador</span>

          <Buscador id="buscador-sidebar" />

          <nav className="side-nav" aria-label="Navegación principal">
            {DESTINOS.map(({ to, label, Icono, badge }) => (
              <Link
                key={to}
                to={to}
                aria-current={esActivo(to) ? 'page' : undefined}
                className={`side-nav__item${esActivo(to) ? ' side-nav__item--active' : ''}`}
              >
                <Icono />
                <span>{label}</span>
                {badge && recordatoriosPendientes > 0 && (
                  <span className="nav-badge">{recordatoriosPendientes}</span>
                )}
              </Link>
            ))}
          </nav>

          <Link to={NUEVO_ITEM.to} state={NUEVO_ITEM.state} className="side-nuevo">
            <IconoMas />
            NUEVO ITEM
          </Link>

          <div className="side-foot">
            <Link
              to={asistenteTo}
              title={asistenteTitulo}
              aria-disabled={!asistenteActivo}
              className={`side-asistente${asistenteActivo ? '' : ' side-asistente--off'}`}
            >
              <IconoChispa />
              <span>Asistente IA</span>
            </Link>

            <div className="side-cuenta">
              <span className="side-cuenta__avatar" aria-hidden="true">
                {iniciales}
              </span>
              <div className="side-cuenta__datos">
                <span className="side-cuenta__email" title={user?.email}>
                  {user?.email}
                </span>
                <SyncStatus />
              </div>
            </div>

            <button onClick={() => supabase.auth.signOut()} className="link-underline side-salir">
              Cerrar sesión
            </button>
          </div>
        </aside>
      )}

      <div className="shell__main">
        {!wide && (
          <header className="shell__topbar">
            <div className="shell__topbar-row">
              <span className="shell__brand-mobile">Organizador</span>
              <SyncStatus />
              <button
                type="button"
                onClick={() => setTheme(temaSiguiente)}
                className="icon-btn"
                aria-label={temaSiguiente === 'dark' ? 'Activar modo oscuro' : 'Activar modo claro'}
                title={temaSiguiente === 'dark' ? 'Modo oscuro' : 'Modo claro'}
              >
                {theme === 'dark' ? <IconoSol /> : <IconoLuna />}
              </button>
            </div>
            <Buscador id="buscador-topbar" />
          </header>
        )}

        <Outlet />

        {!wide && (
          <>
            {/* Cinco celdas: los dos primeros destinos, el "+" al medio, y los
                dos últimos. */}
            <nav className="tabbar" aria-label="Navegación principal">
              {DESTINOS.slice(0, 2).map(celda)}
              <Link
                to={NUEVO_ITEM.to}
                state={NUEVO_ITEM.state}
                className="tabbar__fab"
                aria-label="Nuevo item"
              >
                <IconoMas size={24} />
              </Link>
              {DESTINOS.slice(2).map(celda)}
            </nav>

            {/* Sobre la propia página del asistente el FAB no tiene a dónde
                llevar, así que no se dibuja. */}
            {location.pathname !== '/assistant' && (
              <Link
                to={asistenteTo}
                title={asistenteTitulo}
                aria-label={asistenteTitulo}
                aria-disabled={!asistenteActivo}
                className={`fab-asistente${asistenteActivo ? '' : ' fab-asistente--off'}`}
              >
                <IconoChispa size={24} />
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  )
}
