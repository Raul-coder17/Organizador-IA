// Lógica pura (sin I/O ni Deno.serve) de parseo de function-calls de Gemini y
// mapeo a "acciones propuestas". Se aísla acá para poder testearla con
// `deno test` sin levantar el server ni tocar la red.

export interface GeminiPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}

export interface FunctionCall {
  name: string
  args: Record<string, unknown>
}

// Tools de solo lectura que la Edge Function ejecuta server-side.
export const READ_TOOLS = new Set(['listItems', 'listRecordatorios'])

// Extrae TODAS las function calls de un candidate (Gemini puede devolver varias
// en un mismo turno: parallel function calling).
export function allFunctionCalls(parts: GeminiPart[]): FunctionCall[] {
  return parts
    .filter((p) => p.functionCall)
    .map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {} }))
}

// Separa las calls de un turno en tools de lectura vs. acciones "propose*".
export function partitionCalls(calls: FunctionCall[]): {
  reads: FunctionCall[]
  proposes: FunctionCall[]
} {
  const reads = calls.filter((c) => READ_TOOLS.has(c.name))
  const proposes = calls.filter((c) => c.name.startsWith('propose'))
  return { reads, proposes }
}

// --- Acciones propuestas (mismas formas que src/types/assistant.ts) ----------

export interface AccionCrear {
  tipo_accion: 'create'
  tipo: string
  tema: string | null
  prioridad: string | null
  contenido?: string
  lineas?: string[]
  // Fecha/hora local ingenua ("YYYY-MM-DDTHH:mm"); el frontend la convierte a
  // ISO/UTC con la zona del navegador al confirmar (igual que el form manual).
  recordatorio_fecha_hora?: string
}

export interface CambiosUpdate {
  tipo?: string
  tema?: string | null
  prioridad?: string | null
  contenido?: string
  lineas_agregar?: string[]
  lineas_quitar?: string[]
  lineas_marcar_hechas?: string[]
  lineas_desmarcar?: string[]
  recordatorio_fecha_hora?: string
  quitar_recordatorio?: boolean
}

export interface AccionEditar {
  tipo_accion: 'update'
  item_id: string
  cambios: CambiosUpdate
}

export interface AccionBorrar {
  tipo_accion: 'delete'
  item_id: string
}

export type AccionPropuesta = AccionCrear | AccionEditar | AccionBorrar

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const arr = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0)
  return arr.length ? arr : undefined
}

// Mapea una function call `propose*` a su acción. Devuelve null si el nombre no
// es una acción proponible (ej. una tool de lectura o una desconocida).
export function mapProposedAction(name: string, args: Record<string, unknown>): AccionPropuesta | null {
  if (name === 'proposeCreateItem') {
    const accion: AccionCrear = {
      tipo_accion: 'create',
      tipo: str(args.tipo) ?? 'nota',
      tema: str(args.tema) ?? null,
      prioridad: str(args.prioridad) ?? null,
    }
    const lineas = strArray(args.lineas)
    if (lineas) accion.lineas = lineas
    const contenido = str(args.contenido)
    if (contenido) accion.contenido = contenido
    const rec = str(args.recordatorio_fecha_hora)
    if (rec) accion.recordatorio_fecha_hora = rec
    return accion
  }

  if (name === 'proposeUpdateItem') {
    const cambios: CambiosUpdate = {}
    if (str(args.tipo)) cambios.tipo = str(args.tipo)
    if ('tema' in args) cambios.tema = str(args.tema) ?? null
    if (str(args.prioridad)) cambios.prioridad = str(args.prioridad)
    if (str(args.contenido)) cambios.contenido = str(args.contenido)
    const add = strArray(args.lineas_agregar)
    if (add) cambios.lineas_agregar = add
    const quitar = strArray(args.lineas_quitar)
    if (quitar) cambios.lineas_quitar = quitar
    const marcar = strArray(args.lineas_marcar_hechas)
    if (marcar) cambios.lineas_marcar_hechas = marcar
    const desmarcar = strArray(args.lineas_desmarcar)
    if (desmarcar) cambios.lineas_desmarcar = desmarcar
    const rec = str(args.recordatorio_fecha_hora)
    if (rec) cambios.recordatorio_fecha_hora = rec
    if (args.quitar_recordatorio === true) cambios.quitar_recordatorio = true
    return { tipo_accion: 'update', item_id: str(args.item_id) ?? '', cambios }
  }

  if (name === 'proposeDeleteItem') {
    return { tipo_accion: 'delete', item_id: str(args.item_id) ?? '' }
  }

  return null
}

// Arma el array de acciones propuestas a partir de un lote de calls `propose*`.
export function collectProposedActions(proposes: FunctionCall[]): AccionPropuesta[] {
  return proposes
    .map((c) => mapProposedAction(c.name, c.args))
    .filter((a): a is AccionPropuesta => a !== null)
}

// Texto de fallback cuando Gemini no acompaña las acciones con un texto propio.
export function fallbackTextForActions(acciones: AccionPropuesta[]): string {
  if (acciones.length === 0) return 'Preparé una acción para que la confirmes.'
  if (acciones.length === 1) {
    switch (acciones[0].tipo_accion) {
      case 'create':
        return 'Preparé la creación de un item para que la confirmes.'
      case 'update':
        return 'Preparé una edición para que la confirmes.'
      case 'delete':
        return 'Preparé un borrado para que lo confirmes.'
    }
  }
  return `Preparé ${acciones.length} acciones para que las confirmes.`
}
