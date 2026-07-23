import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { countRecordatoriosPendientesHoy } from './repo'
import { subscribeSyncSettled } from './sync'

// Conteo de recordatorios pendientes vencidos o que vencen hoy, para el badge de
// la nav. Devuelve 0 mientras carga (el badge simplemente no se muestra). Sale
// del espejo local, así que también anda sin conexión y ya cuenta los cambios
// que todavía no subieron. Se recalcula al cambiar de ruta (al volver de
// /reminders el número refleja lo que se marcó hecho) y al terminar un sync.
export function useRecordatoriosBadge(): number {
  const { user } = useAuth()
  const location = useLocation()
  const [count, setCount] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeSyncSettled(() => setTick((t) => t + 1)), [])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    countRecordatoriosPendientesHoy()
      .then((n) => {
        if (!cancelled) setCount(n)
      })
      .catch(() => {
        /* el badge es best-effort; si falla, no se muestra */
      })

    return () => {
      cancelled = true
    }
  }, [user, location.pathname, tick])

  return count
}
