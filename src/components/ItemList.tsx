import type { Item, Tema } from '../types/database'

const TIPO_LABEL: Record<string, string> = {
  nota: 'Nota',
  recordatorio: 'Recordatorio',
  lista: 'Lista',
  tabla: 'Tabla',
}

const PRIORIDAD_STYLE: Record<string, string> = {
  alta: 'bg-red-100 text-red-700',
  media: 'bg-amber-100 text-amber-700',
  baja: 'bg-slate-100 text-slate-600',
}

interface ItemListProps {
  items: Item[]
  temas: Tema[]
  onEdit: (item: Item) => void
  onDelete: (id: string) => void
}

export function ItemList({ items, temas, onEdit, onDelete }: ItemListProps) {
  const temaNombre = (id: string | null) =>
    id ? (temas.find((t) => t.id === id)?.nombre ?? 'Tema eliminado') : 'Sin tema'

  const grupos = new Map<string, Item[]>()
  for (const item of items) {
    const key = temaNombre(item.tema_id)
    grupos.set(key, [...(grupos.get(key) ?? []), item])
  }

  return (
    <div className="space-y-6">
      {[...grupos.entries()].map(([nombre, grupoItems]) => (
        <section key={nombre}>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">{nombre}</h2>
          <div className="space-y-2">
            {grupoItems.map((item) => (
              <article key={item.id} className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium bg-slate-100 text-slate-600 rounded px-2 py-0.5">
                      {TIPO_LABEL[item.tipo] ?? item.tipo}
                    </span>
                    {item.prioridad && (
                      <span
                        className={`text-xs font-medium rounded px-2 py-0.5 ${PRIORIDAD_STYLE[item.prioridad]}`}
                      >
                        {item.prioridad}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm shrink-0">
                    <button onClick={() => onEdit(item)} className="text-slate-500 hover:text-slate-800">
                      Editar
                    </button>
                    <button onClick={() => onDelete(item.id)} className="text-red-500 hover:text-red-700">
                      Eliminar
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">
                  {typeof item.contenido.texto === 'string'
                    ? item.contenido.texto
                    : JSON.stringify(item.contenido)}
                </p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
