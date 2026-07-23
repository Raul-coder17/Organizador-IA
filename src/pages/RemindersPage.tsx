import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { AppNav } from '../components/AppNav'
import {
  formatFechaHora,
  joinRecordatoriosConItems,
  resumenContenido,
} from '../lib/recordatorios'
import { marcarHecho } from '../lib/repo'
import { loadItemsFromCache, loadRecordatoriosFromCache } from '../lib/db'
import { hasSyncSettled, subscribeSyncSettled } from '../lib/sync'
import type { RecordatorioConItem } from '../types/database'

type Estado = 'vencido' | 'proximo' | 'hecho'

const TIPO_LABEL: Record<string, string> = {
  nota: 'Nota',
  recordatorio: 'Recordatorio',
  lista: 'Lista',
  tabla: 'Tabla',
}

const ESTADO_LABEL: Record<Estado, string> = {
  vencido: 'Vencido',
  proximo: 'Próximo',
  hecho: 'Hecho',
}

// Clasifica un recordatorio: hecho si su estado ya es 'hecho'; vencido si su
// fecha ya pasó y sigue pendiente; próximo en el resto de los casos.
function clasificar(rec: RecordatorioConItem, ahora: number): Estado {
  if (rec.estado === 'hecho') return 'hecho'
  if (new Date(rec.fecha_hora).getTime() < ahora) return 'vencido'
  return 'proximo'
}

export function RemindersPage() {
  const { user } = useAuth()
  const [recordatorios, setRecordatorios] = useState<RecordatorioConItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marcando, setMarcando] = useState<string | null>(null)

  // Igual que ItemsPage: leemos siempre del espejo local (recordatorios planos
  // + items, unidos acá en la forma que usa la vista) y releemos cuando el
  // motor de sync termina un ciclo.
  const load = useCallback(async () => {
    if (!user) return
    setError(null)
    try {
      const [recs, items] = await Promise.all([
        loadRecordatoriosFromCache(),
        loadItemsFromCache(),
      ])
      setRecordatorios(joinRecordatoriosConItems(recs, items))
      setLoading(recs.length === 0 && !hasSyncSettled() && navigator.onLine)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando recordatorios')
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => subscribeSyncSettled(load), [load])

  async function handleMarcarHecho(id: string) {
    setMarcando(id)
    setError(null)
    try {
      // Escribe el espejo local y encola la subida: anda igual sin conexión.
      await marcarHecho(id)
      setRecordatorios((prev) =>
        prev.map((r) => (r.id === id ? { ...r, estado: 'hecho' } : r)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar como hecho.')
    } finally {
      setMarcando(null)
    }
  }

  if (!user) return null

  const ahora = Date.now()

  return (
    <div className="min-h-screen bg-paper">
      <AppNav />

      <main className="max-w-[840px] mx-auto px-6 py-8 space-y-6">
        <div className="tema-head">
          <h2>Recordatorios</h2>
          {!loading && (
            <span className="count">
              {recordatorios.length} recordatorio{recordatorios.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {error && <p className="text-sm text-rust">{error}</p>}

        {loading ? (
          <p className="text-sm text-ink-soft">Cargando…</p>
        ) : recordatorios.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Todavía no tenés recordatorios. Agregá uno desde un item, marcando “Agregar
            recordatorio” al crearlo o editarlo.
          </p>
        ) : (
          <ul className="rem-list">
            {recordatorios.map((rec) => {
              const estado = clasificar(rec, ahora)
              return (
                <li key={rec.id} className={`rem rem--${estado}`}>
                  <div className="rem__body">
                    <div className="rem__meta">
                      <span className={`rem__estado rem__estado--${estado}`}>
                        {ESTADO_LABEL[estado]}
                      </span>
                      <span className="rem__when">{formatFechaHora(rec.fecha_hora)}</span>
                      {rec.estado === 'enviado' && (
                        <span className="rem__notificado" title="Ya te enviamos la notificación">
                          ● Notificado
                        </span>
                      )}
                      {rec.item && (
                        <span className="rem__tipo">
                          {TIPO_LABEL[rec.item.tipo] ?? rec.item.tipo}
                        </span>
                      )}
                    </div>
                    <p className="rem__contenido">{resumenContenido(rec.item)}</p>
                  </div>
                  {estado !== 'hecho' && (
                    <div className="rem__actions">
                      <button
                        onClick={() => handleMarcarHecho(rec.id)}
                        disabled={marcando === rec.id}
                        className="btn-ghost"
                      >
                        {marcando === rec.id ? 'Guardando…' : 'Marcar hecho'}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
