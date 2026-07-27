import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { BorrarCuenta } from '../components/BorrarCuenta'
import { PushSettings } from '../components/PushSettings'
import { SyncSettings } from '../components/SyncSettings'
import { readAiEnabledCache, writeAiEnabledCache } from '../lib/useAiEnabled'
import { useSyncStatus } from '../lib/useSyncStatus'
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

// Nombre de perfil.
//
// Se guarda en `user_metadata` de Supabase Auth (ver `leerNombre` en
// AuthContext), no en una tabla propia: para un dato de una línea no vale la
// pena tabla + RLS + sync, y como viaja dentro de la sesión, la sesión cacheada
// que la app levanta para arrancar sin red ya lo trae. Lo usa el saludo de Hoy.
//
// Guardar SÍ necesita conexión — es una escritura contra Auth, no pasa por el
// outbox como los ítems. Así que el botón se apaga sin señal y se dice por qué,
// en vez de dejar que `updateUser` falle con un error de red genérico.
function NombrePerfil() {
  const { user, nombre } = useAuth()
  const { online } = useSyncStatus()
  const [valor, setValor] = useState(nombre ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // `updateUser` emite USER_UPDATED y el AuthContext reemplaza la sesión: el
  // nombre del contexto vuelve acá y sincroniza el input. También cubre el caso
  // de que la sesión llegue después del primer render (arranque offline).
  useEffect(() => {
    setValor(nombre ?? '')
  }, [nombre])

  const limpio = valor.trim()
  const sinCambios = limpio === (nombre ?? '')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || sinCambios) return

    setGuardando(true)
    setError(null)
    setInfo(null)

    // Guardamos el nombre YA recortado: lo que se persiste es lo que se muestra.
    const { error } = await supabase.auth.updateUser({ data: { nombre: limpio } })

    setGuardando(false)

    if (error) {
      setError(error.message ?? 'No se pudo guardar el nombre.')
      return
    }
    setInfo(limpio ? 'Nombre guardado.' : 'Nombre borrado.')
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="nombrePerfil">
          Nombre
        </label>
        <input
          id="nombrePerfil"
          type="text"
          autoComplete="given-name"
          maxLength={40}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Cómo querés que te salude"
          className="ctl w-full"
        />
        <p className="text-xs text-ink-soft mt-1.5">
          Aparece en el saludo de Hoy. Si lo dejás vacío, el saludo va sin nombre.
        </p>
      </div>

      <button type="submit" disabled={guardando || sinCambios || !online} className="btn-moss">
        {guardando ? 'Guardando…' : 'Guardar nombre'}
      </button>

      {!online && (
        // ink-soft y no slate, por lo mismo que el banner del asistente: es una
        // explicación de por qué el botón está apagado, no un adorno.
        <p className="text-xs text-ink-soft">
          Sin conexión — el nombre se guarda en tu cuenta, así que hace falta señal.
        </p>
      )}
      {error && <p className="text-sm text-rust">{error}</p>}
      {info && <p className="text-sm text-moss">{info}</p>}
    </form>
  )
}

export function SettingsPage() {
  const { user } = useAuth()
  const [aiEnabled, setAiEnabled] = useState(false)
  // El estado de IA que estamos mostrando salió de la caché local porque la
  // consulta falló (típicamente: sin red). Cambia lo que se dibuja: es el
  // último valor conocido, no uno fresco, y desde acá no se puede tocar.
  const [estadoCacheado, setEstadoCacheado] = useState(false)
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

      if (error) {
        // Mismo criterio que `useAiEnabled`: la consulta que falla no es un
        // "el usuario apagó la IA". Mostramos el último estado conocido y lo
        // decimos, en vez de dibujar "Inactiva" y ofrecer cargar una key que
        // tampoco se podría validar sin red.
        setAiEnabled(readAiEnabledCache(user!.id) ?? false)
        setEstadoCacheado(true)
        setLoading(false)
        return
      }

      const value = data?.ai_enabled ?? false
      writeAiEnabledCache(user!.id, value)
      setAiEnabled(value)
      setEstadoCacheado(false)
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

    // La caché se actualiza en el mismo movimiento que el estado local: es la
    // que van a leer el shell y Hoy la próxima vez que arranquen sin red.
    const activada = Boolean(data?.ai_enabled)
    if (user) writeAiEnabledCache(user.id, activada)
    setAiEnabled(activada)
    setEstadoCacheado(false)
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

    const activada = Boolean(data?.ai_enabled)
    if (user) writeAiEnabledCache(user.id, activada)
    setAiEnabled(activada)
    setEstadoCacheado(false)
    setInfo('IA desactivada.')
  }

  if (!user) return null

  return (
    <main className="shell-main space-y-6 max-w-[560px]">
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

          {estadoCacheado ? (
            <p className="text-sm text-ink-soft">
              Sin conexión — este es el último estado que conocemos. Para activarla o desactivarla
              hace falta señal.
            </p>
          ) : !aiEnabled ? (
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

      <hr className="border-line" />

      {/* Cuenta. El chasis nuevo sólo muestra el email y el "cerrar sesión"
          en el sidebar, que en móvil no existe: sin este bloque, un teléfono
          se quedaba sin forma de salir de la sesión. */}
      <h2 className="font-fraunces text-[19px] font-medium text-ink">Cuenta</h2>

      <div className="bg-card border border-line rounded-[4px] p-5 space-y-5">
        <NombrePerfil />

        <hr className="border-line" />

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm text-ink break-words">{user.email}</p>
            <p className="text-xs text-ink-soft mt-1">Sesión iniciada en este dispositivo.</p>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="btn-outline">
            Cerrar sesión
          </button>
        </div>

        {/* Borrar cuenta va último y detrás de su propia línea: es irreversible
            y no tiene por qué compartir espacio con "cerrar sesión", que es lo
            que alguien viene a buscar acá el 99% de las veces. */}
        <hr className="border-line" />

        <BorrarCuenta />
      </div>
    </main>
  )
}
