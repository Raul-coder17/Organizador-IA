import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { listItems, deleteItem, updateItem } from '../lib/items'
import { listTemas } from '../lib/temas'
import {
  loadItemsFromCache,
  loadTemasFromCache,
  saveItemsToCache,
  saveTemasToCache,
} from '../lib/db'
import type { Item, LineaLista, Tema } from '../types/database'
import { ItemForm } from '../components/ItemForm'
import { ItemList } from '../components/ItemList'
import { AppNav } from '../components/AppNav'

export function ItemsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<Item[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [filterTemaId, setFilterTemaId] = useState('todos')
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setError(null)

    // 1) Hidratar desde la caché local (instantáneo, sirve sin conexión).
    let hydrated = false
    try {
      const [ci, ct] = await Promise.all([loadItemsFromCache(), loadTemasFromCache()])
      if (ci.length || ct.length) {
        setItems(ci)
        setTemas(ct)
        setLoading(false)
        hydrated = true
      }
    } catch {
      /* caché best-effort: si falla, seguimos con la red */
    }

    // 2) Refrescar desde la red y actualizar la caché.
    try {
      const [itemsData, temasData] = await Promise.all([listItems(user.id), listTemas(user.id)])
      setItems(itemsData)
      setTemas(temasData)
      // Persistimos el estado fresco (best-effort, no bloquea la UI).
      saveItemsToCache(itemsData).catch(() => {})
      saveTemasToCache(temasData).catch(() => {})
    } catch (err) {
      // Sin red: si ya mostramos datos de la caché, los mantenemos sin error
      // destructivo. Si no había caché, sí informamos el fallo (igual que antes).
      if (!hydrated) setError(err instanceof Error ? err.message : 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    load()
  }, [load])

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

  const filteredItems =
    filterTemaId === 'todos'
      ? items
      : filterTemaId === 'sin-tema'
        ? items.filter((item) => item.tema_id === null)
        : items.filter((item) => item.tema_id === filterTemaId)

  return (
    <div className="min-h-screen bg-paper">
      <AppNav />

      <main className="max-w-[840px] mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <select
            value={filterTemaId}
            onChange={(e) => setFilterTemaId(e.target.value)}
            className="ctl ctl--mono"
          >
            <option value="todos">Todos los temas</option>
            <option value="sin-tema">Sin tema</option>
            {temas.map((tema) => (
              <option key={tema.id} value={tema.id}>
                {tema.nombre}
              </option>
            ))}
          </select>

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
          />
        )}

        {error && <p className="text-sm text-rust">{error}</p>}

        {loading ? (
          <p className="text-sm text-ink-soft">Cargando…</p>
        ) : filteredItems.length === 0 ? (
          <p className="text-sm text-ink-soft">
            {items.length === 0
              ? 'Todavía no tenés items. Creá el primero con el botón de arriba.'
              : 'No hay items para este filtro.'}
          </p>
        ) : (
          <ItemList
            items={filteredItems}
            temas={temas}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onToggleLinea={handleToggleLinea}
          />
        )}
      </main>
    </div>
  )
}
