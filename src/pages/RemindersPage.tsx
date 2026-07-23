import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import {
  clasificar,
  joinRecordatoriosConItems,
  type EstadoRecordatorio,
} from '../lib/recordatorios'
import { marcarHecho } from '../lib/repo'
import { loadItemsFromCache, loadRecordatoriosFromCache } from '../lib/db'
import { hasSyncSettled, subscribeSyncSettled } from '../lib/sync'
import { RecordatorioRow } from '../components/RecordatorioRow'
import type { RecordatorioConItem } from '../types/database'

// La clasificación (y las etiquetas de estado y tipo) viven en lib/recordatorios
// desde el ítem 8: la vista Hoy usa el mismo criterio, y dos definiciones de
// "vencido" darían dos números distintos en pantallas que se ven a la vez.
type Filtro = 'todos' | 'vencido' | 'proximo' | 'hecho'

// Orden de los grupos en pantalla: lo que ya se pasó primero, lo resuelto al
// final. Es el orden en que hay que prestarles atención.
const ORDEN_GRUPOS: EstadoRecordatorio[] = ['vencido', 'hoy', 'proximo', 'hecho']

const TITULO_GRUPO: Record<EstadoRecordatorio, string> = {
  vencido: 'Vencidos',
  hoy: 'Hoy',
  proximo: 'Próximos',
  hecho: 'Hechos',
}

const FILTROS: { value: Filtro; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'vencido', label: 'Vencidos' },
  { value: 'proximo', label: 'Próximos' },
  { value: 'hecho', label: 'Hechos' },
]

// "Próximos" en el filtro incluye lo de hoy: son los dos grupos de lo que
// todavía no pasó, y separarlos en el filtro obligaría a un quinto botón para
// una distinción que ya hacen los grupos.
function pasaFiltro(estado: EstadoRecordatorio, filtro: Filtro): boolean {
  if (filtro === 'todos') return true
  if (filtro === 'proximo') return estado === 'proximo' || estado === 'hoy'
  return estado === filtro
}

export function RemindersPage() {
  const { user } = useAuth()
  const [recordatorios, setRecordatorios] = useState<RecordatorioConItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marcando, setMarcando] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todos')

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

  const ahora = new Date()

  // Clasificamos una vez y agrupamos: cada recordatorio cae en exactamente un
  // grupo, y el filtro sólo decide qué grupos se dibujan.
  const clasificados = recordatorios.map((rec) => ({ rec, estado: clasificar(rec, ahora) }))
  const grupos = ORDEN_GRUPOS.map((estado) => ({
    estado,
    items: clasificados.filter((c) => c.estado === estado && pasaFiltro(c.estado, filtro)),
  })).filter((g) => g.items.length > 0)
  const visibles = grupos.reduce((n, g) => n + g.items.length, 0)

  return (
    <main className="shell-main space-y-6">
      <div className="tema-head">
        <h2>Recordatorios</h2>
        {!loading && (
          <span className="count">
            {recordatorios.length} recordatorio{recordatorios.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-rust">{error}</p>}

      {!loading && recordatorios.length > 0 && (
        <div className="segmented hscroll" role="group" aria-label="Filtrar recordatorios">
          {FILTROS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFiltro(value)}
              aria-pressed={filtro === value}
              className={`segmented__btn${filtro === value ? ' segmented__btn--active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-soft">Cargando…</p>
      ) : recordatorios.length === 0 ? (
        <p className="text-sm text-ink-soft">
          Todavía no tenés recordatorios. Agregá uno desde un item, marcando “Agregar
          recordatorio” al crearlo o editarlo.
        </p>
      ) : visibles === 0 ? (
        <p className="text-sm text-ink-soft">No hay recordatorios con este filtro.</p>
      ) : (
        grupos.map((grupo) => (
          <section key={grupo.estado} className="mt-8 first:mt-0">
            <div className={`tema-head${grupo.estado === 'vencido' ? ' tema-head--rust' : ''}`}>
              <h2>{TITULO_GRUPO[grupo.estado]}</h2>
              <span className="count">{grupo.items.length}</span>
            </div>

            <ul className="rem-list">
              {grupo.items.map(({ rec, estado }) => (
                <RecordatorioRow
                  key={rec.id}
                  rec={rec}
                  estado={estado}
                  marcando={marcando === rec.id}
                  onMarcarHecho={handleMarcarHecho}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  )
}
