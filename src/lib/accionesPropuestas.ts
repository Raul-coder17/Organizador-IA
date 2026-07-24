import { createItem, createTema, upsertRecordatorio } from './repo'
import { datetimeLocalToIso } from './recordatorios'
import type { AccionCrear } from '../types/assistant'
import type { Item, ItemInsert, OrigenItem, Prioridad, Tema, TipoItem } from '../types/database'

// Cómo se convierte una acción `create` propuesta por la IA en un item real.
//
// Vive acá y no dentro del asistente porque ahora hay DOS caminos que proponen
// crear un item —el chat (ítem 10) y la foto (ítem 14)— y tienen que guardar
// exactamente igual. Si el "cómo se arma el contenido" viviera en el drawer, la
// foto tendría su propia copia y las dos se irían separando con el tiempo.
//
// Todas las escrituras pasan por `repo.ts`, así que son offline-first igual que
// el CRUD manual: si la conexión se corta entre proponer y confirmar, el item se
// guarda local y se encola. (La extracción en sí sí necesita red — es Gemini —,
// pero eso es antes de este punto.)

// Serializa una tabla {columnas, filas} al texto con pipes que es como la app
// guarda hoy los items tipo "tabla".
//
// Por qué texto y no el jsonb {columnas, filas} estructurado, que `ItemList` ya
// sabe renderizar: porque el editor de grilla es el ítem 12 y todavía no existe.
// Guardado como jsonb, abrir el item en `ItemForm` mostraría el JSON crudo en el
// textarea y guardarlo desde ahí lo destrozaría. Con pipes, la tabla que salió
// de una foto se edita después igual que cualquier otra. Cuando el ítem 12
// llegue, este es el único punto que hay que cambiar.
//
// Una celda que contenga "|" rompería la columna, así que se reemplaza: perder
// un caracter raro en una celda es mejor que desalinear la fila entera.
export function tablaATexto(columnas: string[] | undefined, filas: string[][]): string {
  const limpiar = (c: string) => c.replace(/\|/g, '/').trim()
  const lineas = filas.map((f) => f.map(limpiar).join(' | '))
  if (columnas && columnas.length > 0) {
    lineas.unshift(columnas.map(limpiar).join(' | '))
  }
  return lineas.join('\n')
}

// El jsonb que se guarda en `items.contenido` según el tipo de la acción.
export function contenidoDeAccionCrear(accion: AccionCrear): Record<string, unknown> {
  if (accion.tipo === 'lista' && accion.lineas && accion.lineas.length > 0) {
    return {
      items: accion.lineas.map((t) => ({ id: crypto.randomUUID(), texto: t, hecho: false })),
    }
  }
  if (accion.tipo === 'tabla' && accion.filas && accion.filas.length > 0) {
    return { texto: tablaATexto(accion.columnas, accion.filas) }
  }
  return { texto: accion.contenido ?? '' }
}

// Resuelve el nombre de tema que propuso la IA a un id, creándolo si no existe.
// El tema creado por la IA sale con color automático igual que el manual: el
// default vive en `repo.createTema`, no en el form (Fase 2, D4).
async function resolverTemaId(
  nombre: string | null | undefined,
  userId: string,
  temas: Tema[],
  onTemaCreado?: (tema: Tema) => void,
): Promise<string | null> {
  if (!nombre) return null
  const existente = temas.find((t) => t.nombre.toLowerCase() === nombre.toLowerCase())
  if (existente) return existente.id
  const tema = await createTema(userId, nombre)
  onTemaCreado?.(tema)
  return tema.id
}

/**
 * Aplica una acción `create` propuesta: resuelve el tema, arma el contenido,
 * crea el item y le cuelga el recordatorio si la propuesta traía uno.
 *
 * @param origen de dónde salió la propuesta. Es lo que después distingue en la
 *   base un item dictado por texto de uno leído de una foto — la columna
 *   `items.origen` existe desde el schema inicial justamente para esto.
 * @param onTemaCreado se llama si hubo que crear un tema nuevo, para que el
 *   llamador lo sume a su lista local sin releer todo.
 */
export async function aplicarAccionCrear(
  accion: AccionCrear,
  userId: string,
  temas: Tema[],
  origen: 'texto' | 'foto',
  onTemaCreado?: (tema: Tema) => void,
): Promise<Item> {
  const tema_id = await resolverTemaId(accion.tema, userId, temas, onTemaCreado)

  const payload: ItemInsert = {
    user_id: userId,
    tema_id,
    tipo: accion.tipo,
    prioridad: accion.prioridad,
    contenido: contenidoDeAccionCrear(accion),
    origen,
  }
  const creado = await createItem(payload)

  if (accion.recordatorio_fecha_hora) {
    await upsertRecordatorio(creado.id, datetimeLocalToIso(accion.recordatorio_fecha_hora))
  }
  return creado
}

// Un item propuesto pero todavía no guardado, con los campos ya en la forma que
// usa `ItemForm`. Es lo que permite "editar antes de guardar": la propuesta de
// la IA se abre en el formulario de siempre en vez de exigir guardar-y-después-
// corregir. No es un `Item`: no tiene id ni existe en ningún lado, y por eso el
// form lo trata como creación y no como edición.
export interface BorradorItem {
  tipo: TipoItem
  /** Nombre del tema propuesto (existente o nuevo), no un id: la IA propone
   *  nombres y el form resuelve si ya existe o hay que crearlo. */
  temaNombre: string | null
  prioridad: Prioridad | null
  contenidoTexto: string
  lineas: string[]
  origen: OrigenItem
}

// Convierte una acción propuesta en un borrador editable. La tabla se aplana al
// texto con pipes que el textarea sabe editar, por el mismo motivo que
// `contenidoDeAccionCrear`: el editor de grilla es el ítem 12.
export function borradorDeAccionCrear(accion: AccionCrear, origen: OrigenItem): BorradorItem {
  const contenido =
    accion.tipo === 'tabla' && accion.filas && accion.filas.length > 0
      ? tablaATexto(accion.columnas, accion.filas)
      : (accion.contenido ?? '')

  return {
    tipo: accion.tipo,
    temaNombre: accion.tema,
    prioridad: accion.prioridad,
    contenidoTexto: contenido,
    lineas: accion.lineas ?? [],
    origen,
  }
}
