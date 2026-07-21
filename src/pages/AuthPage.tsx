import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)

    const { error, data } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    if (mode === 'signup' && !data.session) {
      setInfo('Cuenta creada. Si tu proyecto requiere confirmación por email, revisá tu bandeja antes de iniciar sesión.')
    }
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-card border border-line rounded-[2px] p-6">
        <h1 className="app-brand mb-1">Organizador Personal IA</h1>
        <p className="text-sm text-ink-soft mb-6">
          {mode === 'login' ? 'Iniciá sesión para continuar.' : 'Creá una cuenta para empezar.'}
        </p>

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

          <div>
            <label className="label" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="ctl w-full"
            />
          </div>

          {error && <p className="text-sm text-rust">{error}</p>}
          {info && <p className="text-sm text-moss">{info}</p>}

          <button type="submit" disabled={loading} className="btn-moss w-full">
            {loading ? 'Procesando…' : mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login')
            setError(null)
            setInfo(null)
          }}
          className="link-underline mt-4 text-sm"
        >
          {mode === 'login' ? '¿No tenés cuenta? Creá una' : '¿Ya tenés cuenta? Iniciá sesión'}
        </button>
      </div>
    </div>
  )
}
