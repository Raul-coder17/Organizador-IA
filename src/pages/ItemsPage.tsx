import { useCallback, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { deleteItem, updateItem } from '../lib/repo'
import { loadItemsFromCache, loadRecordatoriosFromCache, loadTemasFromCache } from '../lib/db'
import { hasSyncSettled, subscribeSyncSettled } from '../lib/sync'
import type { Item, LineaLista, Recordatorio, Tema, TipoItem } from '../types/database'
import { ItemForm } from '../components/ItemForm'
import { ItemList } from '../components/ItemList'
import { colorDeTema, temaColorVar } from '../lib/temaColores'
import { filtrarItems } from '../lib/buscar'

// Filtro por tipo. 'todos' es el estado neutro; el resto son los cuatro tipos
// reales de item — incluido 'recordatorio', que existe en el modelo y hasta
// ahora no tenía forma de filtrarse.
type FiltroTipo = 'todos' | TipoItem

const FILTROS_TIPO: { value: FiltroTipo; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'nota', label: 'Notas' },
  { value: 'lista', label: 'Listas' },
  { value: 'tabla', label: 'Tablas' },
  { value: 'recordatorio', label: 'Recordatorios' },
]

// Filtro por tema: 'todos', 'sin-tema' (los que tienen `tema_id` null) o el id
// de un tema.
const FILTRO_SIN_TEMA = 'sin-tema'

// Un item puede tener más de un recordatorio; la ficha muestra uno solo. Se
// elige el más urgente: el pendiente más próximo y, si están todos hechos, el
// más reciente en el tiempo.
function indexarRecordatorios(recordatorios: Recordatorio[]): Map<string, Recordatorio> {
  const porItem = new Map<string, Recordatorio>()

  for (const rec of recordatorios) {
    const actual = porItem.get(rec.item_id)
    if (!actual) {
      porItem.set(rec.item_id, rec)
      continue
    }

    const recPendiente = rec.estado !== 'hecho'
    const actualPendiente = actual.estado !== 'hecho'
    if (recPendiente !== actualPendiente) {
      if (recPendiente) porItem.set(rec.item_id, rec)
      continue
    }

    const gana = recPendiente
      ? rec.fecha_hora < actual.fecha_hora // pendientes: el que vence antes
      : rec.fecha_hora > actual.fecha_hora // hechos: el más reciente
    if (gana) porItem.set(rec.item_id, rec)
  }

  return porItem
}

export function ItemsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<Item[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [recordatorios, setRecordatorios] = useState<Map<string, Recordatorio>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [filterTemaId, setFilterTemaId] = useState('todos')
  const [filterTipo, setFilterTipo] = useState<FiltroTipo>('todos')
  const [showForm, setShowForm] = useState(false)
  const location = useLocation()

  // La consulta del buscador global viaja en la URL (`?q=…`, ítem 9). Vive ahí
  // y no en un estado compartido porque el input está en el shell y los
  // resultados acá: la URL es el único lugar que los dos ya miran. De paso, un
  // resultado de búsqueda queda enlazable y sobrevive a un F5.
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''

  // La pantalla lee SIEMPRE del espejo local (instantáneo, igual con o sin
  // red). Quien lo pone al día contra el servidor es el motor de sync, que al
  // terminar cada ciclo avisa y volvemos a leer.
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
      setRecordatorios(indexarRecordatorios(cr))
      // Espejo vacío y todavía sin ningún ciclo de sync (primer arranque con
      // red): seguimos en "Cargando…" hasta que baje algo, para no mostrar un
      // "no tenés items" que es mentira.
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

  // Peticiones que llegan por navegación, de dos lugares distintos:
  //   · `nuevoItem` — el "+" del shell, que no tiene sheet propio hasta el
  //     ítem 11 y abre este formulario (ítem 7).
  //   · `temaId` — una tarjeta de tema de la vista Hoy, que llega pidiendo la
  //     Biblioteca ya filtrada por ese tema (ítem 8). `null` significa "los que
  //     no tienen tema": cómo se llama ese filtro es asunto de esta página.
  // `location.key` cambia en cada navegación, así que pedir lo mismo dos veces
  // seguidas vuelve a aplicarlo.
  useEffect(() => {
    const nav = location.state as { nuevoItem?: boolean; temaId?: string | null } | null
    if (!nav) return

    if (nav.nuevoItem) {
      setEditingItem(null)
      setShowForm(true)
    }
    if ('temaId' in nav) {
      setFilterTemaId(nav.temaId === null ? FILTRO_SIN_TEMA : nav.temaId!)
      setFilterTipo('todos')
    }
  }, [location.key, location.state])

  // Una búsqueda global tiene que ser global: llega con los filtros de tipo y
  // tema en neutro. Si no, el resultado dependería de en qué estado quedó la
  // Biblioteca la última vez —"no aparece" cuando en realidad estaba tapado por
  // un chip de tema puesto hace diez minutos— y "Buscar en todo" sería mentira.
  // Los filtros siguen visibles y se pueden volver a aplicar para acotar.
  useEffect(() => {
    if (!q) return
    setFilterTipo('todos')
    setFilterTemaId('todos')
  }, [q])

  function limpiarBusqueda() {
    const params = new URLSearchParams(searchParams)
    params.delete('q')
    setSearchParams(params, { replace: true })
  }

  function handleSaved() {
    setShowForm(false)
    setEditingItem(null)
    load()
  }

  function handleEdit(item: Item) {
    setEditingItem(item)
    setShowForm(true)
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar este item?')) return
    try {
      await deleteItem(id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error eliminando item')
    }
  }

  function handleTemaCreated(tema: Tema) {
    setTemas((prev) => [...prev, tema].sort((a, b) => a.nombre.localeCompare(b.nombre)))
  }

  // El color de un tema ya se guardó cuando llega acá (repo.updateTemaColor);
  // esto es solo para que el punto cambie en los chips y en los encabezados sin
  // esperar al próximo ciclo de sync.
  function handleTemaUpdated(tema: Tema) {
    setTemas((prev) => prev.map((t) => (t.id === tema.id ? tema : t)))
  }

  // Marca/desmarca una línea de una lista: UI optimista + persistencia; si el
  // guardado falla, revierte al estado previo y muestra el error.
  async function handleToggleLinea(item: Item, lineaId: string) {
    const lineas = Array.isArray(item.contenido.items) ? (item.contenido.items as LineaLista[]) : []
    const nuevasLineas = lineas.map((l) => (l.id === lineaId ? { ...l, hecho: !l.hecho } : l))
    const nuevoContenido = { ...item.contenido, items: nuevasLineas }

    const snapshot = items
    setItems((cur) => cur.map((it) => (it.id === item.id ? { ...it, contenido: nuevoContenido } : it)))
    setError(null)

    try {
      await updateItem(item.id, { contenido: nuevoContenido })
    } catch (err) {
      setItems(snapshot) // revertir el checkbox
      setError(err instanceof Error ? err.message : 'No se pudo guardar el cambio.')
    }
  }

  if (!user) return null

  const coincideTema = (item: Item) =>
    filterTemaId === 'todos' ||
    (filterTemaId === FILTRO_SIN_TEMA ? item.tema_id === null : item.tema_id === filterTemaId)
  const coincideTipo = (item: Item) => filterTipo === 'todos' || item.tipo === filterTipo

  // El texto primero (busca sobre TODOS los items, incluido el nombre del tema
  // de cada uno) y después los filtros de la página, que acotan el resultado.
  const filteredItems = filtrarItems(items, temas, q).filter(
    (item) => coincideTema(item) && coincideTipo(item),
  )
  const hayFiltroActivo = filterTemaId !== 'todos' || filterTipo !== 'todos'
  const buscando = q.length > 0

  return (
    <main className="shell-main space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Buscando, el encabezado dice qué se está mirando: si no, la página
            sigue diciendo "Biblioteca · 47 items" mientras muestra 2, y el
            número de arriba contradice a la lista de abajo. */}
        <div className="tema-head grow">
          <h2>{buscando ? 'Resultados' : 'Biblioteca'}</h2>
          <span className="count">
            {buscando ? (
              <>
                {filteredItems.length} resultado{filteredItems.length === 1 ? '' : 's'} para «{q}»
              </>
            ) : (
              <>
                {items.length} item{items.length === 1 ? '' : 's'} · {temas.length} tema
                {temas.length === 1 ? '' : 's'}
              </>
            )}
          </span>
        </div>

        {buscando && (
          <button type="button" onClick={limpiarBusqueda} className="link-underline">
            Limpiar búsqueda
          </button>
        )}

        <button
          onClick={() => {
            setEditingItem(null)
            setShowForm((v) => !v)
          }}
          className="btn-moss"
        >
          {showForm ? 'Cancelar' : '+ Nuevo item'}
        </button>
      </div>

      {/* Dos niveles de filtro: el tipo acota qué clase de ficha se ve, el
          tema acota de qué va. Se combinan. */}
      <div className="space-y-3">
        <div className="segmented hscroll" role="group" aria-label="Filtrar por tipo">
          {FILTROS_TIPO.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilterTipo(value)}
              aria-pressed={filterTipo === value}
              className={`segmented__btn${filterTipo === value ? ' segmented__btn--active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="chips hscroll" role="group" aria-label="Filtrar por tema">
          <button
            type="button"
            onClick={() => setFilterTemaId('todos')}
            aria-pressed={filterTemaId === 'todos'}
            className={`chip${filterTemaId === 'todos' ? ' chip--active' : ''}`}
          >
            Todos los temas
          </button>
          {temas.map((tema) => (
            <button
              key={tema.id}
              type="button"
              onClick={() => setFilterTemaId(tema.id)}
              aria-pressed={filterTemaId === tema.id}
              className={`chip${filterTemaId === tema.id ? ' chip--active' : ''}`}
            >
              <span
                className="tema-dot"
                style={{ background: temaColorVar(colorDeTema(tema)) }}
                aria-hidden="true"
              />
              {tema.nombre}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFilterTemaId(FILTRO_SIN_TEMA)}
            aria-pressed={filterTemaId === FILTRO_SIN_TEMA}
            className={`chip${filterTemaId === FILTRO_SIN_TEMA ? ' chip--active' : ''}`}
          >
            Sin tema
          </button>
        </div>
      </div>

      {showForm && (
        <ItemForm
          userId={user.id}
          temas={temas}
          editingItem={editingItem}
          onSaved={handleSaved}
          onCancel={() => {
            setShowForm(false)
            setEditingItem(null)
          }}
          onTemaCreated={handleTemaCreated}
          onTemaUpdated={handleTemaUpdated}
        />
      )}

      {error && <p className="text-sm text-rust">{error}</p>}

      {loading ? (
        <p className="text-sm text-ink-soft">Cargando…</p>
      ) : filteredItems.length === 0 ? (
        <p className="text-sm text-ink-soft">
          {buscando
            ? hayFiltroActivo
              ? // Con un chip puesto encima de la búsqueda, "probá otras palabras" manda
                // al lado equivocado: lo que sobra puede ser el filtro, no la consulta.
                `Sin resultados para «${q}» con los filtros de arriba aplicados.`
              : `Sin resultados para «${q}». Probá con otras palabras.`
            : items.length === 0
              ? 'Todavía no tenés items. Creá el primero con el botón de arriba.'
              : hayFiltroActivo
                ? 'No hay items con este filtro.'
                : 'No hay items para mostrar.'}
        </p>
      ) : (
        <ItemList
          items={filteredItems}
          temas={temas}
          recordatorios={recordatorios}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onToggleLinea={handleToggleLinea}
        />
      )}
    </main>
  )
}
