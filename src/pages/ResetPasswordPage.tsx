import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AuthError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { AuthCard } from '../components/AuthCard'

// Mínimo de Supabase por defecto (Authentication → Policies). Es el mismo que
// ya pide el alta de cuenta en AuthPage; si algún día se sube allá, se sube acá.
const MIN_PASSWORD = 6

// El link del correo cae en esta ruta con el token en la URL, y supabase-js lo
// canjea por una sesión de recuperación por su cuenta (`detectSessionInUrl`,
// activo por defecto). Eso es asincrónico: al primer render puede no haber
// sesión todavía, así que la pantalla espera. Si en este tiempo no aparece
// ninguna, es que el link no traía token válido.
const ESPERA_SESION_MS = 5000

type Estado =
  | { tipo: 'verificando' }
  | { tipo: 'listo' }
  | { tipo: 'invalido'; mensaje: string }
  | { tipo: 'guardado' }

// Supabase devuelve los rechazos del link en la propia URL, no como error de
// una llamada: en el hash (flujo implícito) o en la query (PKCE). El caso
// corriente es un link vencido o ya usado — los links de recuperación son de un
// solo uso, así que "ya lo usé" y "se venció" terminan en el mismo lugar.
function errorEnLaUrl(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const query = new URLSearchParams(window.location.search)
  const error = hash.get('error') ?? query.get('error')
  const codigo = hash.get('error_code') ?? query.get('error_code')
  if (!error && !codigo) return null

  if (codigo === 'otp_expired') {
    return 'El link venció. Los links de recuperación duran poco y se usan una sola vez: pedí uno nuevo desde “¿Olvidaste tu contraseña?”.'
  }
  return 'El link no es válido o ya fue usado. Pedí uno nuevo desde “¿Olvidaste tu contraseña?”.'
}

// Los mensajes de Supabase vienen en inglés y hablan de "the user": se traducen
// los que el usuario puede efectivamente encontrarse acá. El resto cae al
// genérico con el texto original detrás, para no esconder un problema real.
function mensajeDeError(error: AuthError): string {
  const texto = error.message.toLowerCase()
  if (texto.includes('should be at least') || texto.includes('password is too short')) {
    return `La contraseña es muy corta: usá al menos ${MIN_PASSWORD} caracteres.`
  }
  if (texto.includes('different from the old password')) {
    return 'La contraseña nueva tiene que ser distinta de la anterior.'
  }
  if (texto.includes('auth session missing') || texto.includes('session_not_found')) {
    return 'La sesión de recuperación venció. Pedí un link nuevo desde “¿Olvidaste tu contraseña?”.'
  }
  if (error.status === 429) {
    return 'Demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.'
  }
  return `No pudimos actualizar la contraseña: ${error.message}`
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [estado, setEstado] = useState<Estado>({ tipo: 'verificando' })
  const [password, setPassword] = useState('')
  const [repeticion, setRepeticion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const enLaUrl = errorEnLaUrl()
    if (enLaUrl) {
      setEstado({ tipo: 'invalido', mensaje: enLaUrl })
      return
    }

    let vigente = true
    const aceptarSesion = () => {
      if (vigente) setEstado({ tipo: 'listo' })
    }

    // Dos caminos al mismo lugar, porque cuál gana depende de cuándo termine
    // supabase-js de leer la URL: si ya la leyó, getSession() la devuelve; si
    // todavía no, llega por el evento PASSWORD_RECOVERY.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) aceptarSesion()
    })
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) aceptarSesion()
      })
      .catch(() => {
        /* sin red: cae en el timeout de abajo con el mensaje de link inválido */
      })

    const timeout = setTimeout(() => {
      if (!vigente) return
      setEstado((actual) =>
        actual.tipo === 'verificando'
          ? {
              tipo: 'invalido',
              mensaje:
                'No pudimos validar el link. Puede haber vencido, o haberse abierto en otro navegador del que salió el correo. Pedí uno nuevo desde “¿Olvidaste tu contraseña?”.',
            }
          : actual,
      )
    }, ESPERA_SESION_MS)

    return () => {
      vigente = false
      clearTimeout(timeout)
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    // Las dos validaciones locales van antes de la llamada: no tiene sentido
    // gastar un viaje al servidor para que rebote algo que ya se ve acá.
    if (password.length < MIN_PASSWORD) {
      setError(`La contraseña es muy corta: usá al menos ${MIN_PASSWORD} caracteres.`)
      return
    }
    if (password !== repeticion) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError(mensajeDeError(error))
      return
    }

    // El link de recuperación deja la sesión iniciada, así que después de
    // guardar el usuario ya está adentro: se lo manda a Hoy y no al login.
    // `replace` para que el botón "atrás" no vuelva a una URL con el token.
    setEstado({ tipo: 'guardado' })
    setTimeout(() => navigate('/', { replace: true }), 2000)
  }

  if (estado.tipo === 'verificando') {
    return (
      <AuthCard subtitulo="Restablecer contraseña">
        <p className="text-sm text-ink-soft">Validando el link…</p>
      </AuthCard>
    )
  }

  if (estado.tipo === 'invalido') {
    return (
      <AuthCard subtitulo="Restablecer contraseña">
        <p className="text-sm text-rust">{estado.mensaje}</p>
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="btn-moss w-full mt-5"
        >
          Volver al inicio
        </button>
      </AuthCard>
    )
  }

  if (estado.tipo === 'guardado') {
    return (
      <AuthCard subtitulo="Restablecer contraseña">
        <p className="text-sm text-moss">
          Listo: tu contraseña quedó actualizada. Te llevamos a la app…
        </p>
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="btn-moss w-full mt-5"
        >
          Ir a Hoy
        </button>
      </AuthCard>
    )
  }

  return (
    <AuthCard subtitulo="Elegí tu contraseña nueva.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="password">
            Contraseña nueva
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="ctl w-full"
          />
          <p className="text-xs text-ink-soft mt-1.5">Mínimo {MIN_PASSWORD} caracteres.</p>
        </div>

        <div>
          <label className="label" htmlFor="repeticion">
            Repetila
          </label>
          <input
            id="repeticion"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={repeticion}
            onChange={(e) => setRepeticion(e.target.value)}
            className="ctl w-full"
          />
        </div>

        {error && <p className="text-sm text-rust">{error}</p>}

        <button type="submit" disabled={loading} className="btn-moss w-full">
          {loading ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </AuthCard>
  )
}
