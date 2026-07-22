import { useLocalReminderWatcher } from '../lib/useLocalReminderWatcher'

// Componente sin UI: solo monta el watcher del aviso local de recordatorios una
// sola vez, cerca de la raíz de la app (dentro de ProtectedRoute, así corre
// solo con sesión y en cualquier pantalla).
export function LocalReminderWatcher() {
  useLocalReminderWatcher()
  return null
}
