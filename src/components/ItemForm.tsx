import { useEffect, useState, type FormEvent } from 'react'
import type { Item, ItemInsert, LineaLista, Prioridad, Tema, TipoItem } from '../types/database'
// Todas las escrituras del form pasan por el repositorio local: se guardan al
// instante en IndexedDB y se encolan para subir, así el form funciona igual con
// o sin conexión (PLAN_OFFLINE.md ítems 5-6).
import {
  createItem,
  createTema,
  deleteRecordatoriosForItem,
  getRecordatorioForItem,
  updateItem,
  upsertRecordatorio,
} from '../lib/repo'
import { datetimeLocalToIso, isoToDatetimeLocal } from '../lib/recordatorios'

function nuevaLinea(): LineaLista {
  return { id: crypto.randomUUID(), texto: '', hecho: false }
}

interface ItemFormProps {
  userId: string
  temas: Tema[]
  editingItem: Item | null
  onSaved: () => void
  onCancel: () => void
  onTemaCreated: (tema: Tema) => void
}

const TIPOS: TipoItem[] = ['nota', 'recordatorio', 'lista', 'tabla']
const PRIORIDADES: Prioridad[] = ['alta', 'media', 'baja']

export function ItemForm({ userId, temas, editingItem, onSaved, onCancel, onTemaCreated }: ItemFormProps) {
  const [tipo, setTipo] = useState<TipoItem>('nota')
  const [temaId, setTemaId] = useState<string>('')
  const [nuevoTemaNombre, setNuevoTemaNombre] = useState('')
  const [prioridad, setPrioridad] = useState<Prioridad | ''>('')
  const [contenidoTexto, setContenidoTexto] = useState('')
  const [lineas, setLineas] = useState<LineaLista[]>([])
  const [conRecordatorio, setConRecordatorio] = useState(false)
  const [recordatorioFecha, setRecordatorioFecha] = useState('')
  // Marca si el item que estamos editando ya tenía un recordatorio, para saber
  // si al desmarcar el toggle hay que eliminarlo.
  const [teniaRecordatorio, setTeniaRecordatorio] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editingItem) {
      setTipo(editingItem.tipo)
      setTemaId(editingItem.tema_id ?? '')
      setPrioridad(editingItem.prioridad ?? '')
      const texto = editingItem.contenido.texto
      setContenidoTexto(typeof texto === 'string' ? texto : JSON.stringify(editingItem.contenido))
      // Al editar una lista con la forma nueva, preservamos hecho de cada línea.
      const itemsGuardados = editingItem.contenido.items
      setLineas(
        Array.isArray(itemsGuardados)
          ? (itemsGuardados as LineaLista[]).map((l) => ({
              id: typeof l.id === 'string' ? l.id : crypto.randomUUID(),
              texto: String(l.texto ?? ''),
              hecho: Boolean(l.hecho),
            }))
          : [],
      )
    } else {
      setTipo('nota')
      setTemaId('')
      setPrioridad('')
      setContenidoTexto('')
      setLineas([])
    }
    setNuevoTemaNombre('')
    setError(null)

    // Recordatorio: reseteamos primero y, si estamos editando, cargamos el que
    // exista para prellenar el toggle y la fecha.
    setConRecordatorio(false)
    setRecordatorioFecha('')
    setTeniaRecordatorio(false)

    if (editingItem) {
      let cancelled = false
      getRecordatorioForItem(editingItem.id)
        .then((rec) => {
          if (cancelled || !rec) return
          setConRecordatorio(true)
          setTeniaRecordatorio(true)
          setRecordatorioFecha(isoToDatetimeLocal(rec.fecha_hora))
        })
        .catch(() => {
          /* si falla la carga del recordatorio, el form igual funciona sin él */
        })
      return () => {
        cancelled = true
      }
    }
  }, [editingItem])

  // Aseguramos al menos una línea en blanco cuando el tipo es "lista".
  useEffect(() => {
    if (tipo === 'lista' && lineas.length === 0) {
      setLineas([nuevaLinea()])
    }
  }, [tipo, lineas.length])

  const updateLinea = (id: string, texto: string) =>
    setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, texto } : l)))
  const removeLinea = (id: string) => setLineas((prev) => prev.filter((l) => l.id !== id))
  const addLinea = () => setLineas((prev) => [...prev, nuevaLinea()])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    // Para "lista" el contenido son las líneas; para el resto, el textarea.
    let contenido: Record<string, unknown>
    if (tipo === 'lista') {
      const items = lineas
        .map((l) => ({ ...l, texto: l.texto.trim() }))
        .filter((l) => l.texto.length > 0)
      if (items.length === 0) {
        setError('Agregá al menos una línea a la lista.')
        return
      }
      contenido = { items }
    } else {
      if (!contenidoTexto.trim()) {
        setError('El contenido no puede estar vacío.')
        return
      }
      contenido = { texto: contenidoTexto.trim() }
    }

    if (temaId === 'new' && !nuevoTemaNombre.trim()) {
      setError('Escribí un nombre para el tema nuevo.')
      return
    }

    if (conRecordatorio && !recordatorioFecha) {
      setError('Elegí una fecha y hora para el recordatorio.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      let temaIdFinal: string | null = temaId === '' ? null : temaId

      if (temaId === 'new') {
        const tema = await createTema(userId, nuevoTemaNombre.trim())
        onTemaCreated(tema)
        temaIdFinal = tema.id
      }

      const payload: ItemInsert = {
        user_id: userId,
        tema_id: temaIdFinal,
        tipo,
        prioridad: prioridad === '' ? null : prioridad,
        contenido,
        origen: 'manual',
      }

      const saved = editingItem
        ? await updateItem(editingItem.id, payload)
        : await createItem(payload)

      // Sincronizamos el recordatorio según el toggle:
      //  - marcado con fecha → upsert (crea o actualiza, estado 'pendiente')
      //  - desmarcado pero antes existía → eliminarlo
      if (conRecordatorio && recordatorioFecha) {
        await upsertRecordatorio(saved.id, datetimeLocalToIso(recordatorioFecha))
      } else if (!conRecordatorio && teniaRecordatorio) {
        await deleteRecordatoriosForItem(saved.id)
      }

      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando el item')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card border border-line rounded-[2px] p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="tipo">
            Tipo
          </label>
          <select
            id="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoItem)}
            className="ctl ctl--mono w-full"
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="prioridad">
            Prioridad
          </label>
          <select
            id="prioridad"
            value={prioridad}
            onChange={(e) => setPrioridad(e.target.value as Prioridad | '')}
            className="ctl ctl--mono w-full"
          >
            <option value="">Sin prioridad</option>
            {PRIORIDADES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="tema">
          Tema
        </label>
        <select
          id="tema"
          value={temaId}
          onChange={(e) => setTemaId(e.target.value)}
          className="ctl ctl--mono w-full"
        >
          <option value="">Sin tema</option>
          {temas.map((tema) => (
            <option key={tema.id} value={tema.id}>
              {tema.nombre}
            </option>
          ))}
          <option value="new">+ Crear tema nuevo…</option>
        </select>

        {temaId === 'new' && (
          <input
            type="text"
            value={nuevoTemaNombre}
            onChange={(e) => setNuevoTemaNombre(e.target.value)}
            placeholder="Nombre del tema nuevo"
            className="ctl w-full mt-2"
          />
        )}
      </div>

      <div>
        <label className="label" htmlFor="contenido">
          {tipo === 'lista' ? 'Líneas de la lista' : 'Contenido'}
        </label>

        {tipo === 'lista' ? (
          <div className="space-y-2">
            {lineas.map((l, idx) => (
              <div key={l.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={l.texto}
                  onChange={(e) => updateLinea(l.id, e.target.value)}
                  placeholder={`Línea ${idx + 1}`}
                  className="ctl flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeLinea(l.id)}
                  aria-label="Quitar línea"
                  className="btn-linea"
                  disabled={lineas.length === 1}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={addLinea} className="btn-ghost">
              + Agregar línea
            </button>
          </div>
        ) : (
          <textarea
            id="contenido"
            value={contenidoTexto}
            onChange={(e) => setContenidoTexto(e.target.value)}
            rows={4}
            placeholder={
              tipo === 'tabla' ? 'Columna1 | Columna2\nDato1 | Dato2\nDato3 | Dato4' : undefined
            }
            className="ctl w-full"
          />
        )}
      </div>

      <div className="rec-toggle">
        <label className="rec-toggle__check">
          <input
            type="checkbox"
            checked={conRecordatorio}
            onChange={(e) => setConRecordatorio(e.target.checked)}
          />
          <span>Agregar recordatorio</span>
        </label>

        {conRecordatorio && (
          <input
            type="datetime-local"
            value={recordatorioFecha}
            onChange={(e) => setRecordatorioFecha(e.target.value)}
            className="ctl ctl--mono mt-2"
            aria-label="Fecha y hora del recordatorio"
          />
        )}
      </div>

      {error && <p className="text-sm text-rust">{error}</p>}

      <div className="flex items-center gap-4">
        <button type="submit" disabled={loading} className="btn-moss">
          {loading ? 'Guardando…' : editingItem ? 'Guardar cambios' : 'Crear item'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancelar
        </button>
      </div>
    </form>
  )
}
