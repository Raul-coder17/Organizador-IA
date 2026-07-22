import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { countRecordatoriosPendientesHoy } from './recordatorios'

// Conteo de recordatorios pendientes vencidos o que vencen hoy, para el badge de
// la nav. Devuelve 0 mientras carga (el badge simplemente no se muestra). Se
// recalcula al cambiar de ruta, así al volver de /reminders el número se
// actualiza tras marcar alguno como hecho.
export function useRecordatoriosBadge(): number {
  const { user } = useAuth()
  const location = useLocation()
  const [count, setCount] = useState(0)

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
  }, [user, location.pathname])

  return count
}
