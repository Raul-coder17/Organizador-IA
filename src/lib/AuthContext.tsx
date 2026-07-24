import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthContextValue {
  session: Session | null
  user: User | null
  /** Nombre de perfil, o `null` si el usuario todavía no configuró ninguno. */
  nombre: string | null
  loading: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// `supabase.auth.getSession()` puede colgarse (no resuelve NI rechaza) cuando el
// token guardado está vencido y no hay red: supabase-js intenta refrescarlo y su
// auto-refresh/lock queda esperando la red para siempre. Sin timeout, `loading`
// nunca baja y la app queda pegada en "Cargando…" antes de montar nada (mismo
// patrón de `await` colgado que ya arreglamos con swReadyOrNull en push.ts). Le
// ponemos un tope: si getSession no contesta a tiempo, arrancamos igual.
const GET_SESSION_TIMEOUT_MS = 3000

// Lee la sesión cacheada directamente de storage, SIN pasar por getSession() (que
// es justo lo que se cuelga). supabase-js persiste la sesión como JSON bajo una
// clave `sb-<ref>-auth-token`. Fallback best-effort para arrancar offline con la
// sesión cacheada aunque el token esté vencido: offline no hay forma de refrescar
// igual, y si después una llamada falla por token vencido, cada pantalla ya
// maneja su error offline. Cuando vuelve la red, supabase refresca solo y emite
// el evento que actualiza la sesión (ver onAuthStateChange).
function readCachedSession(): Session | null {
  try {
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith('sb-') && k.endsWith('-auth-token'),
    )
    if (!key) return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // v2 guarda la sesión directamente; versiones viejas la envolvían en
    // { currentSession }. Soportamos ambas formas.
    const candidate = parsed?.access_token ? parsed : (parsed?.currentSession ?? null)
    return candidate?.access_token ? (candidate as Session) : null
  } catch {
    return null
  }
}

// El nombre de perfil vive en los metadatos del usuario de Supabase Auth
// (`user_metadata.nombre`), no en una tabla propia. Además de ahorrarse tabla,
// RLS y sync para un dato de una línea, la razón de fondo es offline: los
// metadatos viajan DENTRO de la sesión, así que la sesión cacheada que
// `readCachedSession` levanta de storage para arrancar sin red ya trae el
// nombre. El saludo de Hoy funciona sin conexión sin ningún trabajo extra.
//
// Se normaliza acá y no en cada pantalla: un nombre en blanco (el usuario
// borró el campo y guardó) tiene que valer lo mismo que no haber configurado
// ninguno, o el saludo saldría con una coma colgando.
function leerNombre(user: User | null): string | null {
  const raw = user?.user_metadata?.nombre
  if (typeof raw !== 'string') return null
  const nombre = raw.trim()
  return nombre.length > 0 ? nombre : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // getSession() contra un timeout. Si resuelve a tiempo, usamos su resultado;
    // si vence el timeout (offline + token vencido), caemos a la sesión cacheada
    // de storage en vez de colgarnos. El .catch evita un unhandled rejection si
    // getSession rechaza tarde, después de que el timeout ya ganó la carrera.
    const viaClient = supabase.auth
      .getSession()
      .then(({ data }) => data.session)
      .catch(() => null)
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), GET_SESSION_TIMEOUT_MS),
    )

    Promise.race([viaClient, timeout]).then((result) => {
      setSession(result === 'timeout' ? readCachedSession() : result)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // `supabase.auth.updateUser` emite USER_UPDATED, que el listener de arriba ya
  // recibe: cuando Ajustes guarda el nombre, la sesión se reemplaza y el saludo
  // de Hoy se actualiza solo, sin recargar ni volver a pedir nada.
  const user = session?.user ?? null

  return (
    <AuthContext.Provider value={{ session, user, nombre: leerNombre(user), loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
