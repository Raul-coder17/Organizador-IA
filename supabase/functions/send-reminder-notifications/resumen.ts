// Gemelo de dos módulos del cliente, reducidos a lo que necesita el título de
// la notificación del push:
//   - src/lib/recordatorios.ts::resumenContenido()
//   - src/lib/tabla.ts::leerTabla() (y sus helpers de parseo)
//
// Ver recurrencia.ts en esta misma carpeta para la explicación larga de por
// qué hay gemelos en vez de código compartido (runtimes que no se pueden
// importar entre sí). Mismo trato acá: cualquier cambio en cómo se resume el
// contenido de un item va también en los dos archivos del cliente.

interface Tabla {
  headers: string[] | null
  rows: string[][]
}

function cell(v: unknown): string {
  return v == null ? '' : String(v)
}

// Reducido de tabla.ts::parseTabla — soporta { columnas|headers, filas|rows }
// con filas de arrays u objetos, igual que el cliente.
function parseTabla(contenido: Record<string, unknown>): Tabla | null {
  const c = contenido
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

function partirLinea(l: string): string[] {
  return l
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

// Reducido de tabla.ts::parseTextTable — la forma vieja, texto con pipes.
function parseTextTable(texto: string): Tabla | null {
  const lines = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.includes('|'))
  if (lines.length < 2) return null

  const isSeparator = (l: string) => /-/.test(l) && /^[\s|:-]+$/.test(l)
  const dataLines = lines.filter((l) => !isSeparator(l))
  if (dataLines.length < 2) return null

  const headers = partirLinea(dataLines[0])
  const rows = dataLines.slice(1).map(partirLinea)
  const cols = Math.max(headers.length, ...rows.map((r) => r.length))
  const pad = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? '')
  return { headers: pad(headers), rows: rows.map(pad) }
}

function leerTabla(contenido: Record<string, unknown>): Tabla | null {
  return (
    parseTabla(contenido) ??
    (typeof contenido?.texto === 'string' ? parseTextTable(contenido.texto) : null)
  )
}

// Resumen textual del contenido de un item, para el TÍTULO de la notificación
// (aviso local y push): lo que el usuario tiene que hacer, no un genérico
// "Recordatorio". Gemelo exacto de resumenContenido() en
// src/lib/recordatorios.ts — ver ahí el detalle de cada rama.
export function resumenContenido(
  item: { tipo?: string; contenido?: Record<string, unknown> } | null,
): string {
  if (!item) return 'Item eliminado'
  const c = item.contenido ?? {}
  if (item.tipo === 'lista' && Array.isArray(c.items)) {
    const lineas = c.items as { texto?: unknown }[]
    const total = lineas.length
    const preview = lineas
      .slice(0, 3)
      .map((l) => String(l.texto ?? ''))
      .filter(Boolean)
      .join(', ')
    return total > 3 ? `${preview}… (${total} líneas)` : preview || 'Lista vacía'
  }
  if (item.tipo === 'tabla') {
    const tabla = leerTabla(c)
    if (tabla) {
      const cabeceras = (tabla.headers ?? []).map((h) => h.trim()).filter(Boolean).join(' · ')
      const filas = `${tabla.rows.length} fila${tabla.rows.length === 1 ? '' : 's'}`
      return cabeceras ? `${cabeceras} (${filas})` : filas
    }
  }
  if (typeof c.texto === 'string' && c.texto.trim()) return c.texto.trim()
  return JSON.stringify(c)
}
