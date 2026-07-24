// Lectura y escritura del contenido de los items tipo "tabla".
//
// Vive acá y no dentro de un componente porque ahora hay dos lados que tienen
// que coincidir: `ItemList` la lee para renderizarla y `ItemForm` la lee para
// cargar la grilla editable y la vuelve a escribir al guardar. Si el parseo
// viviera en la lista, el editor tendría su propia copia y las dos se irían
// separando (el mismo motivo por el que `accionesPropuestas.ts` centraliza cómo
// se arma el contenido de una propuesta).
//
// Hay dos formas guardadas en la base, y las dos se leen:
//
//   - **estructurada** — `{ columnas: string[], filas: string[][] }`. Es la que
//     escribe el editor de grilla (PLAN_REDISEÑO.md ítem 12) y la única que se
//     escribe desde este ítem en adelante.
//   - **texto con pipes** — `{ texto: "A | B\nC | D" }`. Es como se guardaban
//     las tablas antes del editor: desde el textarea y desde la captura por
//     foto. No hace falta migrarlas: se leen igual, y la primera vez que se
//     editan salen ya en la forma estructurada.

/** Una tabla lista para renderizar. `headers` es null si el contenido no traía
 *  encabezados (una tabla estructurada puede no tener `columnas`). */
export interface Tabla {
  headers: string[] | null
  rows: string[][]
}

/** Una tabla lista para editar: siempre con encabezados y al menos una fila, y
 *  con todas las filas del mismo ancho que `columnas`. Es lo que necesita una
 *  grilla — un editor no puede mostrar "sin encabezados" ni filas dentadas. */
export interface Grilla {
  columnas: string[]
  filas: string[][]
}

const COLUMNAS_NUEVAS = 2
const FILAS_NUEVAS = 2

function cell(v: unknown): string {
  return v == null ? '' : String(v)
}

/** Nombre por defecto de la columna `i` (0-based), para cuando no hay uno. */
export function nombreColumna(i: number): string {
  return `Columna ${i + 1}`
}

// Intenta interpretar el jsonb de un item tipo "tabla" como una tabla real.
// Soporta { columnas|headers, filas|rows } con filas de arrays u objetos, o un
// array top-level de filas. Devuelve null si no hay forma tabular reconocible.
export function parseTabla(contenido: Record<string, unknown>): Tabla | null {
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

// Parseo de una tabla escrita como texto con pipes (o markdown), que es la forma
// vieja. Ej:
//   Columna1 | Columna2
//   Dato1    | Dato2
// La primera fila con datos son los encabezados; se ignoran filas separadoras
// de markdown (---|---).
export function parseTextTable(texto: string): Tabla | null {
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

function partirLinea(l: string): string[] {
  return l
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

/**
 * La tabla de un item, venga en la forma que venga: primero se prueba la
 * estructurada y, si no, el texto con pipes. Null si el contenido no es una
 * tabla reconocible (ahí el llamador muestra el texto crudo).
 */
export function leerTabla(contenido: Record<string, unknown>): Tabla | null {
  return (
    parseTabla(contenido) ??
    (typeof contenido?.texto === 'string' ? parseTextTable(contenido.texto) : null)
  )
}

/** La grilla de arranque de una tabla nueva: 2×2 vacía con encabezados puestos.
 *  Se prellenan con nombre en vez de dejarlos en blanco a propósito: lo que se
 *  ve es lo que se guarda, y un encabezado vacío renderiza una banda muda. */
export function grillaVacia(): Grilla {
  return {
    columnas: Array.from({ length: COLUMNAS_NUEVAS }, (_, i) => nombreColumna(i)),
    filas: Array.from({ length: FILAS_NUEVAS }, () => Array.from({ length: COLUMNAS_NUEVAS }, () => '')),
  }
}

// Empareja una tabla leída con lo que la grilla necesita: todas las filas del
// ancho de la más ancha, encabezados para todas las columnas y nunca cero filas.
function aGrilla({ headers, rows }: Tabla): Grilla {
  const ancho = Math.max(headers?.length ?? 0, ...rows.map((r) => r.length), 1)
  // `?? ` y no `||`: un encabezado guardado en blanco se respeta como está, sólo
  // se inventa nombre para las columnas que directamente no lo tienen.
  const columnas = Array.from({ length: ancho }, (_, i) => headers?.[i] ?? nombreColumna(i))
  const filas = rows.map((r) => Array.from({ length: ancho }, (_, i) => r[i] ?? ''))
  return { columnas, filas: filas.length > 0 ? filas : [columnas.map(() => '')] }
}

/**
 * Grilla editable a partir de un texto con pipes. Más tolerante que
 * `parseTextTable`, porque acá no se puede devolver "no es una tabla": el
 * usuario abrió el editor y algo hay que mostrarle.
 *  - varias líneas con pipes → encabezados + filas (el caso normal)
 *  - una sola línea con pipes → son los encabezados, con una fila en blanco
 *  - sin pipes → una columna, una fila por línea
 */
export function grillaDesdeTexto(texto: string): Grilla {
  const tabla = parseTextTable(texto)
  if (tabla) return aGrilla(tabla)

  const lineas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lineas.length === 0) return grillaVacia()

  if (lineas.length === 1 && lineas[0].includes('|')) {
    const columnas = partirLinea(lineas[0])
    return { columnas, filas: [columnas.map(() => '')] }
  }

  return { columnas: [nombreColumna(0)], filas: lineas.map((l) => [l]) }
}

/**
 * Grilla editable a partir del `contenido` de un item. Es el punto de entrada
 * del editor: resuelve sola la forma nueva, la vieja con pipes y el caso de un
 * item que todavía no tiene nada.
 */
export function grillaDesdeContenido(contenido: Record<string, unknown> | null | undefined): Grilla {
  if (!contenido) return grillaVacia()

  const tabla = parseTabla(contenido)
  if (tabla) return aGrilla(tabla)

  const texto = typeof contenido.texto === 'string' ? contenido.texto : ''
  if (texto.trim().length > 0) return grillaDesdeTexto(texto)

  return grillaVacia()
}

/**
 * El jsonb a guardar para una grilla editada, o null si la tabla quedó vacía.
 *
 * Recorta todas las celdas, empareja el ancho de las filas al de las columnas y
 * descarta las filas que quedaron enteras en blanco (agregar una fila y no
 * llenarla es lo más normal del mundo, y no tiene por qué guardarse). Devuelve
 * null cuando no queda ninguna fila con datos: sin filas, la tabla no se
 * renderiza como tabla, así que es mejor pedirle al usuario que la complete que
 * guardar algo que después se ve como JSON crudo.
 */
export function contenidoDeGrilla(grilla: Grilla): { columnas: string[]; filas: string[][] } | null {
  const columnas = grilla.columnas.map((c) => c.trim())
  if (columnas.length === 0) return null

  const filas = grilla.filas
    .map((f) => Array.from({ length: columnas.length }, (_, i) => (f[i] ?? '').trim()))
    .filter((f) => f.some((c) => c.length > 0))
  if (filas.length === 0) return null

  return { columnas, filas }
}
