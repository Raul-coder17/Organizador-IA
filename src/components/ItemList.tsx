import type { Item, Tema } from '../types/database'

const TIPO_LABEL: Record<string, string> = {
  nota: 'Nota',
  recordatorio: 'Recordatorio',
  lista: 'Lista',
  tabla: 'Tabla',
}

const PRIORIDAD_LABEL: Record<string, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}

interface ItemListProps {
  items: Item[]
  temas: Tema[]
  onEdit: (item: Item) => void
  onDelete: (id: string) => void
}

function cell(v: unknown): string {
  return v == null ? '' : String(v)
}

// Intenta interpretar el jsonb de un item tipo "tabla" como una tabla real.
// Soporta { columnas|headers, filas|rows } con filas de arrays u objetos, o un
// array top-level de filas. Devuelve null si no hay forma tabular reconocible.
function parseTabla(contenido: Record<string, unknown>): { headers: string[] | null; rows: string[][] } | null {
  const c = contenido as Record<string, unknown>
  const rawRows = (c.filas ?? c.rows ?? (Array.isArray(c) ? c : null)) as unknown
  if (!Array.isArray(rawRows) || rawRows.length === 0) return null

  const rawHeaders = (c.columnas ?? c.headers) as unknown
  const headers = Array.isArray(rawHeaders) ? rawHeaders.map(cell) : null

  const allObjects = rawRows.every((r) => r != null && typeof r === 'object' && !Array.isArray(r))
  if (allObjects) {
    const keys =
      headers ??
      Array.from(new Set(rawRows.flatMap((r) => Object.keys(r as Record<string, unknown>))))
    const rows = rawRows.map((r) => keys.map((k) => cell((r as Record<string, unknown>)[k])))
    return { headers: keys, rows }
  }

  const allArrays = rawRows.every((r) => Array.isArray(r))
  if (allArrays) {
    return { headers, rows: rawRows.map((r) => (r as unknown[]).map(cell)) }
  }

  return null
}

// Parseo de una tabla escrita como texto con pipes (o markdown), que es como
// se crean los items "tabla" desde el textarea o el asistente. Ej:
//   Columna1 | Columna2
//   Dato1    | Dato2
// La primera fila con datos son los encabezados; se ignoran filas separadoras
// de markdown (---|---).
function parseTextTable(texto: string): { headers: string[] | null; rows: string[][] } | null {
  const lines = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.includes('|'))
  if (lines.length < 2) return null

  const isSeparator = (l: string) => /-/.test(l) && /^[\s|:-]+$/.test(l)
  const split = (l: string) =>
    l
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())

  const dataLines = lines.filter((l) => !isSeparator(l))
  if (dataLines.length < 2) return null

  const headers = split(dataLines[0])
  const rows = dataLines.slice(1).map(split)
  const cols = Math.max(headers.length, ...rows.map((r) => r.length))
  const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? '')
  return { headers: pad(headers), rows: rows.map(pad) }
}

function ItemContent({ item }: { item: Item }) {
  if (item.tipo === 'tabla') {
    const tabla =
      parseTabla(item.contenido) ??
      (typeof item.contenido?.texto === 'string' ? parseTextTable(item.contenido.texto) : null)
    if (tabla) {
      return (
        <div className="item-table-wrap">
          <table className="item-table">
            {tabla.headers && (
              <thead>
                <tr>
                  {tabla.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {tabla.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
  }

  const texto =
    typeof item.contenido?.texto === 'string' ? item.contenido.texto : JSON.stringify(item.contenido)
  return <div className="item-content">{texto}</div>
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
    <div>
      {[...grupos.entries()].map(([nombre, grupoItems]) => (
        <section key={nombre} className="mt-9 first:mt-0">
          <div className="tema-head">
            <h2>{nombre}</h2>
            <span className="count">
              {grupoItems.length} item{grupoItems.length === 1 ? '' : 's'}
            </span>
          </div>

          {grupoItems.map((item) => (
            <article
              key={item.id}
              className={`item item--${item.prioridad ?? 'none'}`}
            >
              <div className="item-body">
                <div className="item-meta">
                  <span className="item-tipo">{TIPO_LABEL[item.tipo] ?? item.tipo}</span>
                  {item.prioridad && (
                    <span className={`item-prio item-prio--${item.prioridad}`}>
                      {PRIORIDAD_LABEL[item.prioridad]}
                    </span>
                  )}
                </div>
                <ItemContent item={item} />
              </div>
              <div className="item-actions">
                <button onClick={() => onEdit(item)}>Editar</button>
                <button className="del" onClick={() => onDelete(item.id)}>
                  Eliminar
                </button>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}
