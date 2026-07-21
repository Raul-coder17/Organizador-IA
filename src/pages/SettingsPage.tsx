import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { AppNav } from '../components/AppNav'

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
    <div className="min-h-screen bg-slate-50">
      <AppNav />

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        <h2 className="text-lg font-semibold text-slate-800">Configuración de IA</h2>

        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : (
          <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
            <p className="text-sm text-slate-600">
              Estado:{' '}
              {aiEnabled ? (
                <span className="font-medium text-green-700">Activa</span>
              ) : (
                <span className="font-medium text-slate-500">Inactiva</span>
              )}
            </p>

            {!aiEnabled ? (
              <form onSubmit={handleSave} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="apiKey">
                    API key de Gemini
                  </label>
                  <input
                    id="apiKey"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving || !apiKey.trim()}
                  className="rounded bg-slate-800 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                >
                  {saving ? 'Validando…' : 'Guardar y activar'}
                </button>
              </form>
            ) : (
              <button
                onClick={handleRemove}
                disabled={saving}
                className="rounded border border-red-300 text-red-600 px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
              >
                {saving ? 'Procesando…' : 'Desactivar / quitar key'}
              </button>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {info && <p className="text-sm text-green-600">{info}</p>}
          </div>
        )}

        <p className="text-xs text-slate-400">
          Tu API key se valida contra Gemini y se guarda cifrada en el servidor. Nunca se guarda en el
          navegador ni se vuelve a mostrar en pantalla.
        </p>
      </main>
    </div>
  )
}
