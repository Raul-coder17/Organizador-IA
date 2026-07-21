import { useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabase'

// Devuelve el estado de IA del usuario: null mientras carga, luego boolean.
export function useAiEnabled(): boolean | null {
  const { user } = useAuth()
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    supabase
      .from('user_ai_settings')
      .select('ai_enabled')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setAiEnabled(data?.ai_enabled ?? false)
      })

    return () => {
      cancelled = true
    }
  }, [user])

  return aiEnabled
}
