// Buscador global (PLAN_REDISEÑO.md ítem 9).
//
// Módulo PURO (sin IndexedDB, sin red, sin DOM): testeable con `deno test`,
// igual que syncCore.ts, reminderScheduling.ts y temaColores.ts. Quien lee la
// caché es la página; acá sólo se decide qué texto de un ítem es buscable y qué
// cuenta como coincidencia.
//
// QUÉ CUBRE (la pregunta que §5.2 dejaba abierta): ítems y nombres de tema. No
// la tabla `recordatorios` — un recordatorio no tiene texto propio, su texto es
// el del ítem al que cuelga, así que buscarlo aparte devolvería el mismo ítem
// dos veces. Los ítems de tipo `recordatorio` sí se buscan, porque son ítems.
// El placeholder del input dice exactamente eso.

import type { Item, Tema } from '../types/database'

// Normalización para comparar: sin mayúsculas y sin tildes. Buscar "prestamo"
// tiene que encontrar "préstamo" — en castellano lo contrario se siente roto, y
// nadie escribe tildes en un buscador.
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

// La consulta se parte en palabras y TODAS tienen que aparecer (AND), en
// cualquier orden y en cualquier parte del texto del ítem. Con OR, escribir dos
// palabras devolvía más resultados que escribir una, que es lo contrario de lo
// que uno espera mientras tipea.
export function tokens(consulta: string): string[] {
  return normalizar(consulta).split(/\s+/).filter((t) => t.length > 0)
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object'
}

// Junta las cadenas de un valor arbitrario del jsonb, saltando las claves que
// no son texto para el usuario. `id` es la importante: las líneas de una lista
// llevan uuid, y sin esta exclusión buscar "a" hacía match con medio archivo.
const CLAVES_NO_BUSCABLES = new Set(['id', 'hecho'])

function juntarStrings(valor: unknown, salida: string[], profundidad = 0): void {
  if (profundidad > 4) return
  if (typeof valor === 'string') {
    salida.push(valor)
    return
  }
  if (typeof valor === 'number') {
    salida.push(String(valor))
    return
  }
  if (Array.isArray(valor)) {
    for (const v of valor) juntarStrings(v, salida, profundidad + 1)
    return
  }
  if (esObjeto(valor)) {
    for (const [clave, v] of Object.entries(valor)) {
      if (CLAVES_NO_BUSCABLES.has(clave)) continue
      juntarStrings(v, salida, profundidad + 1)
    }
  }
}

// El texto buscable de un ítem, según su tipo:
//   nota / recordatorio → contenido.texto
//   lista               → el texto de cada línea
//   tabla               → encabezados y celdas ({columnas, filas}), o el texto
//                         con pipes de las tablas viejas (§5.2)
// El caso general recorre el jsonb entero, que es lo que mantiene esto vivo
// cuando aparezca un tipo nuevo o una forma de contenido que no previmos: es
// preferible que el buscador encuentre de más a que un ítem sea inencontrable.
export function textoBuscableDeItem(item: Item): string {
  const partes: string[] = []
  juntarStrings(item.contenido, partes)
  return partes.join(' ')
}

export interface ItemConTema {
  item: Item
  /** Nombre del tema del ítem, o null si no tiene (o si el tema ya no existe). */
  tema: string | null
}

// Índice de búsqueda de un ítem: su contenido + el nombre de su tema. El tema
// entra al mismo saco a propósito — buscar "finanzas" tiene que traer los ítems
// del tema Finanzas aunque ninguno diga esa palabra, que es justamente el caso
// en que uno busca por tema.
function indiceDe(item: Item, temasPorId: Map<string, string>): string {
  const nombreTema = item.tema_id ? temasPorId.get(item.tema_id) : undefined
  return normalizar(`${textoBuscableDeItem(item)} ${nombreTema ?? ''}`)
}

// Filtra ítems por texto libre. Consulta vacía devuelve todo tal cual (mismo
// array, sin copiar): "no estoy buscando" no es "no hay resultados".
export function filtrarItems(items: Item[], temas: Tema[], consulta: string): Item[] {
  const t = tokens(consulta)
  if (t.length === 0) return items

  const temasPorId = new Map(temas.map((tema) => [tema.id, tema.nombre]))
  return items.filter((item) => {
    const indice = indiceDe(item, temasPorId)
    return t.every((token) => indice.includes(token))
  })
}

// Temas cuyo nombre coincide con la consulta. Lo usa el encabezado de
// resultados para poder decir "3 ítems en 1 tema" en vez de sólo un número.
export function filtrarTemas(temas: Tema[], consulta: string): Tema[] {
  const t = tokens(consulta)
  if (t.length === 0) return temas

  return temas.filter((tema) => {
    const indice = normalizar(tema.nombre)
    return t.every((token) => indice.includes(token))
  })
}
