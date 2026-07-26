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

// Tools que proponen un cambio (no se ejecutan acá: las confirma el usuario).
// Es la lista CERRADA de nombres que se pueden reinyectar como `functionCall` al
// reconstruir el historial: mandarle a Gemini una call con un nombre que no
// declaramos sería inventarle una tool que no existe.
export const PROPOSE_TOOLS = new Set([
  'proposeCreateItem',
  'proposeUpdateItem',
  'proposeDeleteItem',
])

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
  // Hora local sola ("HH:mm"), sin fecha. Es lo que manda el modelo con
  // recurrencia 'diario' o 'dias_semana': la primera fecha la calcula el
  // frontend, igual que el form manual cuando el usuario elige esas dos.
  recordatorio_hora?: string
  // 'diario' | 'semanal' | 'mensual' | 'dias_semana'. Ausente = el recordatorio
  // es de una sola vez, que es el default de siempre.
  recordatorio_recurrencia?: string
  // Sólo para 'dias_semana': días 0-6 (0=domingo) en la zona LOCAL del usuario.
  // El frontend los pasa a UTC al confirmar, igual que hace con la fecha.
  recordatorio_dias?: number[]
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
  recordatorio_hora?: string
  // Ausente = no se toca la recurrencia. `null` = apagarla (el recordatorio
  // pasa a ser de una sola vez, sin borrarlo).
  recordatorio_recurrencia?: 'diario' | 'semanal' | 'mensual' | 'dias_semana' | null
  // Días 0-6 (0=domingo) en zona LOCAL, sólo con recurrencia 'dias_semana'.
  recordatorio_dias?: number[]
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

// Recurrencia válida, o undefined si Gemini mandó cualquier otra cosa. El enum
// de la tool declaration no es garantía (el modelo puede inventar), y la columna
// tiene un CHECK: un valor raro que llegara hasta la base haría fallar la
// escritura entera. Preferimos degradar a "una sola vez".
//
// 'ninguna' es el valor centinela para APAGAR una recurrencia existente: se
// mapea a null (explícito) y no a undefined (ausente), porque son cosas
// distintas — ausente significa "no lo toques".
function recurrencia(v: unknown): 'diario' | 'semanal' | 'mensual' | 'dias_semana' | undefined {
  return v === 'diario' || v === 'semanal' || v === 'mensual' || v === 'dias_semana'
    ? v
    : undefined
}

// Días de la semana propuestos por la IA: enteros 0-6 con 0=domingo, en la
// zona LOCAL del usuario (igual que `recordatorio_fecha_hora`, que también
// viaja como hora local ingenua). El frontend los convierte a la escala UTC que
// se guarda, con la misma función que usa el form manual.
//
// Se filtra en vez de rechazar el lote entero: si el modelo cuela un 7, es
// mejor guardar los días buenos que perder la acción completa. Sin días
// válidos devuelve undefined y `dias_semana` degrada a "no se repite".
function diasSemana(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  const limpios = new Set<number>()
  for (const bruto of v) {
    const n = typeof bruto === 'number' ? bruto : Number(bruto)
    if (Number.isInteger(n) && n >= 0 && n <= 6) limpios.add(n)
  }
  if (limpios.size === 0) return undefined
  // Orden de semana (lunes primero, domingo último), igual que el cliente.
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => limpios.has(d))
}

// Hora suelta "HH:mm" (24h) normalizada a dos dígitos, o undefined si no lo es.
// Se valida acá y no en el cliente por lo mismo que la recurrencia: el modelo
// puede mandar "7", "7am" o "las siete", y una hora ilegible tiene que degradar
// a "no hay hora" en vez de producir un Invalid Date que se guarde.
function hora(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(v)
  if (!m) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return undefined
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
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
    const hs = hora(args.recordatorio_hora)
    if (hs) accion.recordatorio_hora = hs
    const rep = recurrencia(args.recordatorio_recurrencia)
    if (rep) {
      const dias = diasSemana(args.recordatorio_dias)
      // 'dias_semana' sin días no se puede calcular: se descarta la recurrencia
      // entera en vez de guardar un recordatorio que nunca podría reprogramarse.
      if (rep !== 'dias_semana' || dias) {
        accion.recordatorio_recurrencia = rep
        if (rep === 'dias_semana' && dias) accion.recordatorio_dias = dias
      }
    }
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
    const hs = hora(args.recordatorio_hora)
    if (hs) cambios.recordatorio_hora = hs
    // 'ninguna' apaga la recurrencia; un valor válido la pone o la cambia;
    // cualquier otra cosa (o su ausencia) deja la recurrencia como estaba.
    if (args.recordatorio_recurrencia === 'ninguna') {
      cambios.recordatorio_recurrencia = null
    } else {
      const rep = recurrencia(args.recordatorio_recurrencia)
      const dias = diasSemana(args.recordatorio_dias)
      if (rep && (rep !== 'dias_semana' || dias)) {
        cambios.recordatorio_recurrencia = rep
        if (rep === 'dias_semana' && dias) cambios.recordatorio_dias = dias
      }
    }
    if (args.quitar_recordatorio === true) cambios.quitar_recordatorio = true
    return { tipo_accion: 'update', item_id: str(args.item_id) ?? '', cambios }
  }

  if (name === 'proposeDeleteItem') {
    return { tipo_accion: 'delete', item_id: str(args.item_id) ?? '' }
  }

  return null
}

// Una acción propuesta junto con la function call EXACTA que la originó. Las dos
// caras viajan juntas: `accion` es la forma normalizada que dibuja la tarjeta de
// preview y que el cliente sabe aplicar, y `call` es lo que Gemini realmente
// emitió, que es lo que hay que devolverle en el historial para que reconozca su
// propia jugada. Reconstruir la call desde la acción no serviría: el mapeo
// normaliza y descarta cosas (una recurrencia inválida, un 7 en los días), así
// que la vuelta no daría los mismos args.
export interface Propuesta {
  call: FunctionCall
  accion: AccionPropuesta
}

// Empareja cada call `propose*` con su acción, descartando las que no mapean.
// Devolver los pares —en vez de dos arrays por separado— es lo que garantiza que
// call y acción no se desalineen cuando alguna se descarta.
export function collectProposals(proposes: FunctionCall[]): Propuesta[] {
  const out: Propuesta[] = []
  for (const call of proposes) {
    const accion = mapProposedAction(call.name, call.args)
    if (accion) out.push({ call, accion })
  }
  return out
}

// Arma el array de acciones propuestas a partir de un lote de calls `propose*`.
export function collectProposedActions(proposes: FunctionCall[]): AccionPropuesta[] {
  return collectProposals(proposes).map((p) => p.accion)
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
