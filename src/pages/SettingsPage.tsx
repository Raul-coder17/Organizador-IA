import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { AppNav } from '../components/AppNav'
import { PushSettings } from '../components/PushSettings'
import { SyncSettings } from '../components/SyncSettings'
import { setTheme, useTheme, type Theme } from '../lib/theme'

const TEMAS_UI: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
]

function Apariencia() {
  const theme = useTheme()

  return (
    <div className="bg-card border border-line rounded-[4px] p-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-ink">Tema</p>
          <p className="text-xs text-ink-soft mt-1">Claro u oscuro para toda la app.</p>
        </div>

        <div className="segmented" role="group" aria-label="Tema de la interfaz">
          {TEMAS_UI.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
              className={`segmented__btn${theme === value ? ' segmented__btn--active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate mt-4">
        La primera vez seguimos la preferencia de tu sistema. Cuando elegís acá, mandás vos y
        queda recordado en este navegador.
      </p>
    </div>
  )
}

export function SettingsPage() {
  const { user } = useAuth()
  const [aiEnabled, setAiEnabled] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('user_ai_settings')
        .select('ai_enabled')
        .eq('user_id', user!.id)
        .maybeSingle()

      if (cancelled) return
      if (error) setError(error.message)
      setAiEnabled(data?.ai_enabled ?? false)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!apiKey.trim()) return

    setSaving(true)
    setError(null)
    setInfo(null)

    const { data, error } = await supabase.functions.invoke('manage-ai-key', {
      body: { action: 'save', apiKey: apiKey.trim() },
    })

    setSaving(false)

    if (error) {
      setError(error.message ?? 'No se pudo validar/guardar la key.')
      return
    }

    setAiEnabled(Boolean(data?.ai_enabled))
    setApiKey('')
    setInfo('IA activada correctamente.')
  }

  async function handleRemove() {
    setSaving(true)
    setError(null)
    setInfo(null)

    const { data, error } = await supabase.functions.invoke('manage-ai-key', {
      body: { action: 'remove' },
    })

    setSaving(false)

    if (error) {
      setError(error.message ?? 'No se pudo desactivar la IA.')
      return
    }

    setAiEnabled(Boolean(data?.ai_enabled))
    setInfo('IA desactivada.')
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-paper">
      <AppNav />

      <main className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <h2 className="font-fraunces text-[19px] font-medium text-ink">Apariencia</h2>

        <Apariencia />

        <hr className="border-line" />

        <h2 className="font-fraunces text-[19px] font-medium text-ink">Configuración de IA</h2>

        {loading ? (
          <p className="text-sm text-ink-soft">Cargando…</p>
        ) : (
          <div className="bg-card border border-line rounded-[2px] p-5 space-y-4">
            <p className="text-sm text-ink-soft">
              Estado:{' '}
              {aiEnabled ? (
                <span className="font-mono uppercase tracking-wide text-moss">Activa</span>
              ) : (
                <span className="font-mono uppercase tracking-wide text-slate">Inactiva</span>
              )}
            </p>

            {!aiEnabled ? (
              <form onSubmit={handleSave} className="space-y-3">
                <div>
                  <label className="label" htmlFor="apiKey">
                    API key de Gemini
                  </label>
                  <input
                    id="apiKey"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="ctl w-full"
                  />
                </div>
                <button type="submit" disabled={saving || !apiKey.trim()} className="btn-moss">
                  {saving ? 'Validando…' : 'Guardar y activar'}
                </button>
              </form>
            ) : (
              <button onClick={handleRemove} disabled={saving} className="btn-outline">
                {saving ? 'Procesando…' : 'Desactivar / quitar key'}
              </button>
            )}

            {error && <p className="text-sm text-rust">{error}</p>}
            {info && <p className="text-sm text-moss">{info}</p>}
          </div>
        )}

        <p className="text-xs text-slate">
          Tu API key se valida contra Gemini y se guarda cifrada en el servidor. Nunca se guarda en el
          navegador ni se vuelve a mostrar en pantalla.
        </p>

        <hr className="border-line" />

        <PushSettings />

        <hr className="border-line" />

        <SyncSettings />
      </main>
    </div>
  )
}
