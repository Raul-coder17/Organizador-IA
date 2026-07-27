import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { AuthCard } from '../components/AuthCard'
import { consumirAvisoCuentaBorrada } from '../lib/borrarCuenta'

// La pantalla de sesión tiene tres modos y un solo formulario: los tres piden
// email y sólo dos piden contraseña. Separarlos en tres componentes habría
// duplicado el campo de email, su validación y el manejo de error/info.
type Modo = 'login' | 'signup' | 'recuperar'

const SUBTITULO: Record<Modo, string> = {
  login: 'Iniciá sesión para continuar.',
  signup: 'Creá una cuenta para empezar.',
  recuperar: 'Te mandamos un link para restablecer tu contraseña.',
}

const ACCION: Record<Modo, string> = {
  login: 'Iniciar sesión',
  signup: 'Crear cuenta',
  recuperar: 'Enviar link',
}

export function AuthPage() {
  const [modo, setModo] = useState<Modo>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El aviso de "tu cuenta se borró" se lee UNA vez, en el primer render de esta
  // pantalla: `borrarCuenta` deja una marca en sessionStorage justo antes de
  // cerrar la sesión, y llegar acá es la confirmación de que todo salió. Se lee
  // en el inicializador del estado (no en un efecto) para que el mensaje ya
  // esté en el primer pintado, sin un parpadeo de login pelado.
  const [info, setInfo] = useState<string | null>(() =>
    consumirAvisoCuentaBorrada()
      ? 'Tu cuenta y todos tus datos se borraron. Si querés volver a empezar, creá una cuenta nueva.'
      : null,
  )

  function cambiarModo(siguiente: Modo) {
    setModo(siguiente)
    setError(null)
    setInfo(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)

    if (modo === 'recuperar') {
      // `redirectTo` tiene que ser el origen REAL desde donde se pidió (dev,
      // Render, o la PWA instalada), no una URL fija: el mismo build corre en
      // los tres. Supabase igual sólo redirige a orígenes que estén en su lista
      // de Redirect URLs — ver PLAN_ORGANIZADOR.md.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      setLoading(false)

      // A propósito NO se distingue "el mail existe" de "no existe": el
      // mensaje es el mismo en los dos casos y Supabase tampoco lo dice, así
      // que esta pantalla no sirve para averiguar quién tiene cuenta. El único
      // error que sí se muestra es el de límite de envíos, que no revela nada
      // de la cuenta y explica por qué no llegó el correo.
      if (error) {
        setError(
          error.status === 429
            ? 'Demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.'
            : 'No pudimos enviar el correo. Revisá la dirección y probá de nuevo.',
        )
        return
      }

      setInfo(
        'Si el correo existe, te enviamos un link para restablecer tu contraseña. Revisá tu bandeja de entrada y la carpeta de spam.',
      )
      return
    }

    const { error, data } =
      modo === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    if (modo === 'signup' && !data.session) {
      setInfo('Cuenta creada. Si tu proyecto requiere confirmación por email, revisá tu bandeja antes de iniciar sesión.')
    }
  }

  return (
    <AuthCard subtitulo={SUBTITULO[modo]}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="ctl w-full"
          />
        </div>

        {modo !== 'recuperar' && (
          <div>
            <label className="label" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="ctl w-full"
            />
          </div>
        )}

        {error && <p className="text-sm text-rust">{error}</p>}
        {info && <p className="text-sm text-moss">{info}</p>}

        <button type="submit" disabled={loading} className="btn-moss w-full">
          {loading ? 'Procesando…' : ACCION[modo]}
        </button>
      </form>

      {/* Las salidas del modo actual. En login son dos (crear cuenta, recuperar)
          y por eso van en columna: apiladas se leen como dos caminos distintos,
          en una fila competirían por el mismo lugar. */}
      <div className="mt-4 flex flex-col items-start gap-2 text-sm">
        {modo === 'login' && (
          <>
            <button type="button" onClick={() => cambiarModo('signup')} className="link-underline">
              ¿No tenés cuenta? Creá una
            </button>
            <button
              type="button"
              onClick={() => cambiarModo('recuperar')}
              className="link-underline"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </>
        )}
        {modo !== 'login' && (
          <button type="button" onClick={() => cambiarModo('login')} className="link-underline">
            {modo === 'signup' ? '¿Ya tenés cuenta? Iniciá sesión' : 'Volver a iniciar sesión'}
          </button>
        )}
      </div>
    </AuthCard>
  )
}
