import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { listItems, deleteItem } from '../lib/items'
import { listTemas } from '../lib/temas'
import type { Item, Tema } from '../types/database'
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
    setLoading(true)
    setError(null)
    try {
      const [itemsData, temasData] = await Promise.all([listItems(user.id), listTemas(user.id)])
      setItems(itemsData)
      setTemas(temasData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando datos')
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

  if (!user) return null

  const filteredItems =
    filterTemaId === 'todos'
      ? items
      : filterTemaId === 'sin-tema'
        ? items.filter((item) => item.tema_id === null)
        : items.filter((item) => item.tema_id === filterTemaId)

  return (
    <div className="min-h-screen bg-slate-50">
      <AppNav />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <select
            value={filterTemaId}
            onChange={(e) => setFilterTemaId(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
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
            className="rounded bg-slate-800 text-white px-4 py-2 text-sm font-medium hover:bg-slate-700"
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : filteredItems.length === 0 ? (
          <p className="text-sm text-slate-500">
            {items.length === 0
              ? 'Todavía no tenés items. Creá el primero con el botón de arriba.'
              : 'No hay items para este filtro.'}
          </p>
        ) : (
          <ItemList items={filteredItems} temas={temas} onEdit={handleEdit} onDelete={handleDelete} />
        )}
      </main>
    </div>
  )
}
