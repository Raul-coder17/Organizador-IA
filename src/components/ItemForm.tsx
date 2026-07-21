import { useEffect, useState, type FormEvent } from 'react'
import type { Item, ItemInsert, Prioridad, Tema, TipoItem } from '../types/database'
import { createItem, updateItem } from '../lib/items'
import { createTema } from '../lib/temas'

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editingItem) {
      setTipo(editingItem.tipo)
      setTemaId(editingItem.tema_id ?? '')
      setPrioridad(editingItem.prioridad ?? '')
      const texto = editingItem.contenido.texto
      setContenidoTexto(typeof texto === 'string' ? texto : JSON.stringify(editingItem.contenido))
    } else {
      setTipo('nota')
      setTemaId('')
      setPrioridad('')
      setContenidoTexto('')
    }
    setNuevoTemaNombre('')
    setError(null)
  }, [editingItem])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!contenidoTexto.trim()) {
      setError('El contenido no puede estar vacío.')
      return
    }
    if (temaId === 'new' && !nuevoTemaNombre.trim()) {
      setError('Escribí un nombre para el tema nuevo.')
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
        contenido: { texto: contenidoTexto.trim() },
        origen: 'manual',
      }

      if (editingItem) {
        await updateItem(editingItem.id, payload)
      } else {
        await createItem(payload)
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
          Contenido
        </label>
        <textarea
          id="contenido"
          value={contenidoTexto}
          onChange={(e) => setContenidoTexto(e.target.value)}
          rows={4}
          placeholder={
            tipo === 'tabla'
              ? 'Columna1 | Columna2\nDato1 | Dato2\nDato3 | Dato4'
              : undefined
          }
          className="ctl w-full"
        />
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
