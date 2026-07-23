import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import {
  formatFechaHora,
  joinRecordatoriosConItems,
  resumenContenido,
} from '../lib/recordatorios'
import { marcarHecho } from '../lib/repo'
import { loadItemsFromCache, loadRecordatoriosFromCache } from '../lib/db'
import { hasSyncSettled, subscribeSyncSettled } from '../lib/sync'
import type { RecordatorioConItem } from '../types/database'

type Estado = 'vencido' | 'hoy' | 'proximo' | 'hecho'
type Filtro = 'todos' | 'vencido' | 'proximo' | 'hecho'

const TIPO_LABEL: Record<string, string> = {
  nota: 'Nota',
  recordatorio: 'Recordatorio',
  lista: 'Lista',
  tabla: 'Tabla',
}

const ESTADO_LABEL: Record<Estado, string> = {
  vencido: 'Vencido',
  hoy: 'Hoy',
  proximo: 'Próximo',
  hecho: 'Hecho',
}

// Orden de los grupos en pantalla: lo que ya se pasó primero, lo resuelto al
// final. Es el orden en que hay que prestarles atención.
const ORDEN_GRUPOS: Estado[] = ['vencido', 'hoy', 'proximo', 'hecho']

const TITULO_GRUPO: Record<Estado, string> = {
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

function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// Clasifica un recordatorio: hecho si su estado ya es 'hecho'; vencido si su
// fecha ya pasó y sigue pendiente; hoy si todavía no venció pero es del día en
// curso; próximo en el resto de los casos.
function clasificar(rec: RecordatorioConItem, ahora: Date): Estado {
  if (rec.estado === 'hecho') return 'hecho'
  const fecha = new Date(rec.fecha_hora)
  if (fecha.getTime() < ahora.getTime()) return 'vencido'
  if (mismoDia(fecha, ahora)) return 'hoy'
  return 'proximo'
}

// "Próximos" en el filtro incluye lo de hoy: son los dos grupos de lo que
// todavía no pasó, y separarlos en el filtro obligaría a un quinto botón para
// una distinción que ya hacen los grupos.
function pasaFiltro(estado: Estado, filtro: Filtro): boolean {
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
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  )
}
