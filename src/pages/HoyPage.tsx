import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useAiEnabled } from '../lib/useAiEnabled'
import { clasificar, joinRecordatoriosConItems } from '../lib/recordatorios'
import { marcarHecho } from '../lib/repo'
import { loadItemsFromCache, loadRecordatoriosFromCache, loadTemasFromCache } from '../lib/db'
import { hasSyncSettled, subscribeSyncSettled } from '../lib/sync'
import { colorDeTema, temaColorVar } from '../lib/temaColores'
import { RecordatorioRow } from '../components/RecordatorioRow'
import type { Item, RecordatorioConItem, Tema } from '../types/database'

// Vista Hoy — la landing (PLAN_REDISEÑO.md ítem 8).
//
// Es un resumen, no una fuente: todo sale del mismo espejo local que leen la
// Biblioteca y Recordatorios (IndexedDB vía load*FromCache), y se recalcula
// cuando el motor de sync avisa que terminó un ciclo. Sin llamadas a Supabase:
// abrir la app sin conexión tiene que mostrar los mismos números que con ella.
//
// La clasificación vencido/hoy/próximo NO se reimplementa acá: es la misma
// `clasificar` que usa /reminders (lib/recordatorios). Si divergieran, esta
// pantalla y esa se contradirían con el usuario mirando las dos.

function saludo(hora: number): string {
  if (hora < 6) return 'Buenas noches'
  if (hora < 13) return 'Buenos días'
  if (hora < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

function fechaLarga(ahora: Date): string {
  return ahora.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
}

// Ítems por tema, más el pozo de los que no tienen ninguno. Ese último grupo
// existe por la misma razón que en la Biblioteca (§5.3-3): con `tema_id`
// nullable, mostrar sólo los temas dejaría ítems sin ninguna puerta de entrada.
function contarPorTema(items: Item[]): { porTema: Map<string, number>; sinTema: number } {
  const porTema = new Map<string, number>()
  let sinTema = 0

  for (const item of items) {
    if (item.tema_id === null) {
      sinTema++
      continue
    }
    porTema.set(item.tema_id, (porTema.get(item.tema_id) ?? 0) + 1)
  }

  return { porTema, sinTema }
}

export function HoyPage() {
  const { user } = useAuth()
  const aiEnabled = useAiEnabled()
  const [items, setItems] = useState<Item[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [recordatorios, setRecordatorios] = useState<RecordatorioConItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marcando, setMarcando] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setError(null)
    try {
      const [ci, ct, cr] = await Promise.all([
        loadItemsFromCache(),
        loadTemasFromCache(),
        loadRecordatoriosFromCache(),
      ])
      setItems(ci)
      setTemas(ct)
      setRecordatorios(joinRecordatoriosConItems(cr, ci))
      // Mismo criterio que la Biblioteca: espejo vacío y ningún ciclo de sync
      // todavía es "cargando", no "no tenés nada".
      setLoading(ci.length === 0 && !hasSyncSettled() && navigator.onLine)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando datos')
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
      setRecordatorios((prev) => prev.map((r) => (r.id === id ? { ...r, estado: 'hecho' } : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo marcar como hecho.')
    } finally {
      setMarcando(null)
    }
  }

  if (!user) return null

  const ahora = new Date()
  const clasificados = recordatorios.map((rec) => ({ rec, estado: clasificar(rec, ahora) }))
  const vencidos = clasificados.filter((c) => c.estado === 'vencido')
  const deHoy = clasificados.filter((c) => c.estado === 'hoy')

  const { porTema, sinTema } = contarPorTema(items)

  // El asistente sigue el mismo criterio que el shell: con la IA apagada (o
  // mientras carga) lleva a Ajustes en vez de a una pantalla que no puede usar.
  const asistenteActivo = aiEnabled === true

  return (
    <main className="shell-main hoy">
      <header className="hoy__head">
        <p className="hoy__fecha">{fechaLarga(ahora)}</p>
        <h1 className="hoy__saludo">{saludo(ahora.getHours())}</h1>
      </header>

      <div className="hoy__stats">
        <div className="stat">
          <span className="stat__n stat__n--rust">{vencidos.length}</span>
          <span className="stat__label">Vencidos</span>
        </div>
        <div className="stat">
          <span className="stat__n stat__n--gold">{deHoy.length}</span>
          <span className="stat__label">Para hoy</span>
        </div>
        <div className="stat">
          <span className="stat__n">{items.length}</span>
          <span className="stat__label">Ítems</span>
        </div>
      </div>

      <div className="hoy__acciones hscroll">
        <Link to="/biblioteca" state={{ nuevoItem: true }} className="acceso acceso--moss">
          Nuevo
        </Link>
        {/* La captura por foto no existe todavía (ítem 14). Mismo criterio que
            el buscador en el ítem 7: se dibuja apagada en vez de prometer algo
            que no va a pasar al tocarla. */}
        <button
          type="button"
          disabled
          title="La captura por foto todavía no está construida"
          className="acceso"
        >
          Foto
        </button>
        <Link
          to={asistenteActivo ? '/assistant' : '/settings'}
          title={asistenteActivo ? undefined : 'Activá la IA en Ajustes para usar el asistente'}
          className="acceso"
        >
          Preguntar
        </Link>
      </div>

      {error && <p className="text-sm text-rust">{error}</p>}

      {loading ? (
        <p className="text-sm text-ink-soft">Cargando…</p>
      ) : (
        <>
          {vencidos.length > 0 && (
            <section className="hoy__seccion">
              <div className="tema-head tema-head--rust">
                <h2>Vencidos</h2>
                <span className="count">{vencidos.length}</span>
              </div>
              <ul className="rem-list">
                {vencidos.map(({ rec, estado }) => (
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
          )}

          <section className="hoy__seccion">
            <div className="tema-head">
              <h2>Para hoy</h2>
              {deHoy.length > 0 && <span className="count">{deHoy.length}</span>}
            </div>
            {deHoy.length === 0 ? (
              <p className="text-sm text-ink-soft">Nada vence hoy.</p>
            ) : (
              <ul className="rem-list">
                {deHoy.map(({ rec, estado }) => (
                  <RecordatorioRow
                    key={rec.id}
                    rec={rec}
                    estado={estado}
                    marcando={marcando === rec.id}
                    onMarcarHecho={handleMarcarHecho}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="hoy__seccion">
            <div className="tema-head">
              <h2>Tus temas</h2>
              {temas.length > 0 && <span className="count">{temas.length}</span>}
            </div>

            {temas.length === 0 && sinTema === 0 ? (
              <p className="text-sm text-ink-soft">
                Todavía no tenés temas. Se crean junto con el primer ítem.
              </p>
            ) : (
              <div className="temas-grid">
                {temas.map((tema) => (
                  <Link
                    key={tema.id}
                    to="/biblioteca"
                    state={{ temaId: tema.id }}
                    className="tema-card"
                  >
                    <span className="tema-card__nombre">
                      <span
                        className="tema-dot"
                        style={{ background: temaColorVar(colorDeTema(tema)) }}
                        aria-hidden="true"
                      />
                      {tema.nombre}
                    </span>
                    <span className="tema-card__count">
                      {porTema.get(tema.id) ?? 0} ítem{(porTema.get(tema.id) ?? 0) === 1 ? '' : 's'}
                    </span>
                  </Link>
                ))}

                {sinTema > 0 && (
                  // `temaId: null` = "los que no tienen tema". El nombre del
                  // filtro es asunto de la Biblioteca, no de esta vista.
                  <Link to="/biblioteca" state={{ temaId: null }} className="tema-card">
                    <span className="tema-card__nombre">Sin tema</span>
                    <span className="tema-card__count">
                      {sinTema} ítem{sinTema === 1 ? '' : 's'}
                    </span>
                  </Link>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
