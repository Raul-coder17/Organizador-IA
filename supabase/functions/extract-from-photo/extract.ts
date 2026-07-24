// Lógica pura (sin I/O ni Deno.serve) de la extracción por foto: el prompt, el
// schema de salida y el parseo/saneado de lo que devuelve Gemini. Se aísla acá
// para poder testearla con `deno test` sin levantar el server ni tocar la red,
// igual que `ai-assistant/actions.ts`.

// La acción propuesta que devuelve esta función es la MISMA forma que emite
// `proposeCreateItem` del asistente (ver ai-assistant/actions.ts y
// src/types/assistant.ts): así el frontend reusa tal cual la tarjeta de preview
// con Confirmar/Cancelar, en vez de inventar una segunda forma de propuesta.
//
// Único agregado respecto del asistente: `columnas` / `filas` para el tipo
// "tabla". Es aditivo y opcional — nada que hoy lea una AccionCrear se rompe si
// no vienen. La foto es el primer camino que puede detectar una tabla de verdad
// (un recibo, una planilla escrita a mano), y mostrarla como tabla en el preview
// es lo que hace que confirmar signifique algo: con el texto con pipes suelto no
// se ve si las columnas quedaron bien alineadas.

export const TIPOS = ['nota', 'recordatorio', 'lista', 'tabla'] as const
export const PRIORIDADES = ['alta', 'media', 'baja'] as const

export type TipoItem = (typeof TIPOS)[number]
export type Prioridad = (typeof PRIORIDADES)[number]

export interface AccionCrear {
  tipo_accion: 'create'
  tipo: TipoItem
  tema: string | null
  prioridad: Prioridad | null
  contenido?: string
  lineas?: string[]
  columnas?: string[]
  filas?: string[][]
}

// Schema de salida estructurada. Con `responseMimeType: application/json` +
// `responseSchema`, Gemini devuelve JSON válido y no hay que rescatar el objeto
// de un bloque markdown. `propertyOrdering` importa: la API respeta el orden y
// que `tipo` salga primero ayuda a que el resto se decida en consecuencia.
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tipo: { type: 'STRING', enum: [...TIPOS] },
    tema: { type: 'STRING' },
    prioridad: { type: 'STRING', enum: [...PRIORIDADES] },
    contenido: { type: 'STRING' },
    lineas: { type: 'ARRAY', items: { type: 'STRING' } },
    columnas: { type: 'ARRAY', items: { type: 'STRING' } },
    filas: {
      type: 'ARRAY',
      items: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    resumen: { type: 'STRING' },
  },
  required: ['tipo', 'resumen'],
  propertyOrdering: ['tipo', 'tema', 'prioridad', 'contenido', 'lineas', 'columnas', 'filas', 'resumen'],
} as const

// El prompt. Recibe los temas que el usuario YA tiene para que Gemini reuse uno
// existente en vez de inventar un sinónimo ("Compras" vs "Compra") y llenar la
// biblioteca de temas casi iguales. Puede proponer uno nuevo igual: el usuario
// confirma, y `createTema` le asigna color solo (repo.ts, decisión D4).
export function buildPrompt(temasExistentes: string[], clientNow?: string): string {
  const temas = temasExistentes.length
    ? `\n\nTemas que el usuario ya tiene: ${temasExistentes.map((t) => `"${t}"`).join(', ')}. Si la foto encaja en alguno, usá EXACTAMENTE ese nombre. Si no encaja en ninguno, proponé un tema nuevo, corto y en singular.`
    : '\n\nEl usuario todavía no tiene temas. Proponé uno nuevo, corto y en singular.'

  const ahora = clientNow
    ? `\n- La fecha y hora local del usuario ahora es ${clientNow}. Si la foto tiene una fecha (un turno, un vencimiento), tenela en cuenta para la prioridad.`
    : ''

  return `Mirá esta foto y proponé UN item para el organizador personal del usuario. Respondé SIEMPRE en español.

Elegí el tipo según lo que veas:
- "tabla" — si la foto tiene datos en filas y columnas (un recibo con items y precios, una planilla, un cuadro de horarios). Llená "columnas" con los encabezados y "filas" con una fila por renglón; cada fila tiene que tener la misma cantidad de celdas que "columnas". No uses "contenido".
- "lista" — si son ítems sueltos uno debajo del otro sin columnas (una lista de compras escrita a mano, un checklist). Llená "lineas", una por renglón. No uses "contenido".
- "nota" — texto corrido, un cartel, una página de cuaderno, una pizarra. Llená "contenido" con el texto transcripto y ordenado. No uses "lineas" ni "columnas"/"filas".
- "recordatorio" — sólo si la foto es explícitamente algo que hay que hacer o a lo que hay que ir en una fecha (un turno médico, una invitación con fecha). Llená "contenido".

Reglas:
- Transcribí lo que se lee de verdad. No inventes datos que no estén en la imagen ni completes lo que no se llega a leer: si algo está borroso o cortado, omitilo.
- "prioridad" es opcional: ponela sólo si la foto lo justifica (vencimientos, urgencias marcadas). Si no, dejala vacía.
- "resumen" es una frase corta en español contando qué viste y qué proponés guardar. Es lo que lee el usuario antes de confirmar.
- Si la imagen no tiene nada legible ni interpretable como item, devolvé tipo "nota", contenido vacío y explicá en "resumen" que no se pudo leer nada.${temas}${ahora}`
}

// --- Parseo defensivo de lo que devuelve Gemini -----------------------------

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const arr = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0)
  return arr.length ? arr : undefined
}

// Filas: cada fila es un array de celdas. A diferencia de `strArray`, acá una
// celda vacía SÍ se conserva (una tabla puede tener un hueco legítimo y perderlo
// desalinearía la fila entera); lo que se descarta es la fila entera vacía.
function filasArray(v: unknown): string[][] | undefined {
  if (!Array.isArray(v)) return undefined
  const filas = v
    .filter((f): f is unknown[] => Array.isArray(f))
    .map((f) => f.map((c) => (typeof c === 'string' ? c.trim() : String(c ?? '').trim())))
    .filter((f) => f.some((c) => c.length > 0))
  return filas.length ? filas : undefined
}

function esTipo(v: unknown): v is TipoItem {
  return typeof v === 'string' && (TIPOS as readonly string[]).includes(v)
}

function esPrioridad(v: unknown): v is Prioridad {
  return typeof v === 'string' && (PRIORIDADES as readonly string[]).includes(v)
}

export interface Extraccion {
  accion: AccionCrear
  resumen: string
}

// Rescata el objeto JSON de un texto. Con `responseSchema` Gemini ya devuelve
// JSON pelado, pero si alguna vez lo envuelve en ```json … ``` (pasa cuando el
// modelo ignora el mime type) no queremos fallar por eso.
export function parseJsonLaxo(texto: string): Record<string, unknown> | null {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
  try {
    const parsed = JSON.parse(limpio)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    // Último intento: agarrar el primer objeto balanceado que haya en el texto.
    const desde = limpio.indexOf('{')
    const hasta = limpio.lastIndexOf('}')
    if (desde === -1 || hasta <= desde) return null
    try {
      const parsed = JSON.parse(limpio.slice(desde, hasta + 1))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
}

// Normaliza el objeto crudo de Gemini a una AccionCrear consistente con el tipo
// elegido. Si el modelo se contradice (dice "lista" pero manda `contenido`, o
// dice "tabla" sin filas), mandan los DATOS, no la etiqueta: es preferible
// guardar bien lo que se leyó que respetar un tipo que quedó huérfano de
// contenido. Devuelve null si no hay absolutamente nada aprovechable.
export function normalizarExtraccion(crudo: Record<string, unknown>): Extraccion | null {
  const lineas = strArray(crudo.lineas)
  const columnas = strArray(crudo.columnas)
  const filas = filasArray(crudo.filas)
  const contenido = str(crudo.contenido)
  const resumen = str(crudo.resumen) ?? 'Esto es lo que leí en la foto.'

  let tipo: TipoItem = esTipo(crudo.tipo) ? crudo.tipo : 'nota'

  // Coherencia tipo ↔ datos.
  if (filas) {
    tipo = 'tabla'
  } else if (tipo === 'tabla') {
    // Dijo tabla pero no mandó filas: si hay líneas es una lista, si hay texto
    // es una nota, y si no hay nada no hay item.
    tipo = lineas ? 'lista' : 'nota'
  }
  if (tipo === 'lista' && !lineas) {
    tipo = 'nota'
  }
  if (tipo !== 'tabla' && tipo !== 'lista' && !contenido && lineas) {
    tipo = 'lista'
  }

  const accion: AccionCrear = {
    tipo_accion: 'create',
    tipo,
    tema: str(crudo.tema) ?? null,
    prioridad: esPrioridad(crudo.prioridad) ? crudo.prioridad : null,
  }

  if (tipo === 'tabla') {
    accion.filas = filas
    if (columnas) accion.columnas = columnas
  } else if (tipo === 'lista') {
    accion.lineas = lineas
  } else {
    if (!contenido) return null
    accion.contenido = contenido
  }

  return { accion, resumen }
}
