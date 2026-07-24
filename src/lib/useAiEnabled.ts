import { useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabase'

// Estado de IA del usuario, con memoria del último valor conocido.
//
// `ai_enabled` vive en Supabase (`user_ai_settings`), así que sin red no hay
// forma de leerlo fresco. Antes la consulta fallada devolvía `data: null` y
// esto lo leía como `false`: abrir la app sin señal APAGABA el asistente aunque
// el usuario lo tuviera activo. Un apagón inventado es peor que un dato viejo —
// el botón queda muerto y nada explica por qué.
//
// Ahora cada lectura exitosa se guarda, y sin red se usa ese último valor
// conocido. El botón refleja entonces el estado real más reciente. Que además
// el asistente no pueda responder sin conexión es otra cosa, y la dice la
// propia pantalla del asistente con un banner cuando se lo intenta usar
// (AssistantPage): el estado de la IA y el estado de la red son dos hechos
// distintos y se cuentan por separado.
//
// localStorage y no el store `meta` de IndexedDB a propósito: es síncrono, así
// que el primer render ya sale con el valor cacheado. Con una lectura asíncrona
// habría un parpadeo de "apagado" en cada carga, que es justo lo que se venía
// a arreglar. Mismo criterio que el tema (lib/theme.ts).
//
// La clave lleva el id de usuario: dos cuentas en el mismo navegador no se
// heredan el estado de IA una a la otra.

const PREFIJO_CACHE = 'organizador:aiEnabled:'

// localStorage puede tirar (modo privado, storage bloqueado): sin cache la app
// anda igual, sólo pierde el valor entre sesiones.
export function readAiEnabledCache(userId: string): boolean | null {
  try {
    const raw = localStorage.getItem(PREFIJO_CACHE + userId)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  } catch {
    return null
  }
}

export function writeAiEnabledCache(userId: string, value: boolean): void {
  try {
    localStorage.setItem(PREFIJO_CACHE + userId, String(value))
  } catch {
    /* sin persistencia: el valor vale para esta sesión */
  }
}

// Devuelve el estado de IA del usuario: `null` sólo cuando no hay ni dato
// fresco ni valor cacheado; si no, boolean.
export function useAiEnabled(): boolean | null {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(() =>
    userId ? readAiEnabledCache(userId) : null,
  )

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    // Punto de partida: lo último que supimos de ESTE usuario.
    setAiEnabled(readAiEnabledCache(userId))

    async function refrescar() {
      try {
        const { data, error } = await supabase
          .from('user_ai_settings')
          .select('ai_enabled')
          .eq('user_id', userId!)
          .maybeSingle()

        if (cancelled) return
        // Con error nos quedamos con el cacheado: sin red la consulta falla, y
        // "falló la consulta" no significa "el usuario apagó la IA". Sin error
        // y sin fila sí es un `false` legítimo (nunca la activó), y como tal se
        // cachea.
        if (error) return

        const value = data?.ai_enabled ?? false
        writeAiEnabledCache(userId!, value)
        setAiEnabled(value)
      } catch {
        // supabase-js normalmente devuelve el fallo de red en `error`, pero si
        // llegara a rechazar, sin dato nuevo sigue valiendo el cacheado.
      }
    }

    refrescar()

    return () => {
      cancelled = true
    }
  }, [userId])

  return aiEnabled
}
