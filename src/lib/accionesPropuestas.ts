import {
  datetimeLocalToIso,
  isoToDatetimeLocal,
  proximaFechaConHora,
  recurrenciaSinFecha,
} from './fechaLocal'
import { diasUtcALocales, prepararRecurrencia, proximaOcurrencia, type Recurrencia } from './recurrencia'
import type { AccionCrear, AccionEditar } from '../types/assistant'
import type {
  Item,
  ItemInsert,
  LineaLista,
  OrigenItem,
  Prioridad,
  Recordatorio,
  Tema,
  TipoItem,
} from '../types/database'

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
//
// `repo.ts` se importa DINÁMICO (acá y en `aplicarAccionCrear`) y no arriba del
// módulo: arrastra `supabase.ts`, que lee `import.meta.env` al cargarse, y eso
// es lo único de Vite que `deno test` no puede resolver. Diferido a runtime,
// el resto del módulo —`primeraVuelta`, `fechaLocalDeAccion` y compañía, que sí
// son puros— queda testeable sin arrastrar el cliente de Supabase. En el
// navegador esto no cambia nada: sigue siendo el mismo chunk, solo que Vite lo
// resuelve en el primer `await` en vez de al importar el módulo.
async function resolverTemaId(
  nombre: string | null | undefined,
  userId: string,
  temas: Tema[],
  onTemaCreado?: (tema: Tema) => void,
): Promise<string | null> {
  if (!nombre) return null
  const existente = temas.find((t) => t.nombre.toLowerCase() === nombre.toLowerCase())
  if (existente) return existente.id
  const { createTema } = await import('./repo')
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
  const { createItem, upsertRecordatorio } = await import('./repo')
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

  const fechaLocal = fechaLocalDeAccion(accion)
  if (fechaLocal) {
    // La fecha propuesta es la PRIMERA vuelta; de acá en más lo reprograma solo
    // el repo (o el cron) según esta recurrencia. Los días vienen en escala
    // local, igual que la fecha: `prepararRecurrencia` los pasa a UTC y corre la
    // primera fecha al próximo día marcado, exactamente como el form manual.
    const listo = prepararRecurrencia(
      datetimeLocalToIso(fechaLocal),
      accion.recordatorio_recurrencia ?? null,
      accion.recordatorio_dias,
    )
    await upsertRecordatorio(
      creado.id,
      primeraVuelta(listo.fechaIso, listo.recurrencia, listo.diasUtc),
      listo.recurrencia,
      listo.diasUtc,
    )
  }
  return creado
}

/**
 * La fecha/hora local ("YYYY-MM-DDTHH:mm") de una acción propuesta, venga como
 * fecha completa o como hora sola.
 *
 * Con recurrencia "diario" o "días específicos" el asistente manda sólo
 * `recordatorio_hora`: la fecha de arranque no la elige nadie —igual que en el
 * form manual, donde el selector de fecha ni se muestra— y la calcula el
 * cliente, que es el único que conoce la zona horaria del usuario.
 *
 * Si por lo que sea llegan las dos, manda la hora cuando la recurrencia es de
 * las que no llevan fecha: en ese caso la fecha que el modelo haya calculado es
 * justamente la cuenta que le sacamos de encima.
 */
export function fechaLocalDeAccion(accion: AccionCrear): string | null {
  if (accion.recordatorio_hora && recurrenciaSinFecha(accion.recordatorio_recurrencia)) {
    return proximaFechaConHora(accion.recordatorio_hora)
  }
  return (
    accion.recordatorio_fecha_hora ??
    (accion.recordatorio_hora ? proximaFechaConHora(accion.recordatorio_hora) : null)
  )
}

/**
 * Red de seguridad para las fechas que sí propone el modelo: si una recurrencia
 * arranca en el pasado, se corre a su próxima vuelta real.
 *
 * "Semanal" y "mensual" siguen necesitando que el modelo calcule una fecha, y
 * ahí puede equivocarse de día o quedarse con el de ayer. Un recordatorio
 * recurrente vencido no es inofensivo: vence al instante, se reprograma, y el
 * usuario ve un aviso que no pidió. `proximaOcurrencia` es la misma función que
 * usa el watcher para reenganchar un recordatorio atrasado.
 *
 * No aplica a los de una sola vez: ahí una fecha pasada puede ser deliberada
 * (anotar algo que ya pasó) y no hay "próxima vuelta" que calcular.
 */
export function primeraVuelta(
  fechaIso: string,
  recurrencia: ReturnType<typeof prepararRecurrencia>['recurrencia'],
  diasUtc: number[] | null,
): string {
  if (!recurrencia) return fechaIso
  const ahoraMs = Date.now()
  if (new Date(fechaIso).getTime() > ahoraMs) return fechaIso
  return proximaOcurrencia(fechaIso, recurrencia, ahoraMs, diasUtc)
}

// El recordatorio de un borrador, ya resuelto a lo que el form muestra: fecha/
// hora LOCAL ("YYYY-MM-DDTHH:mm"), recurrencia y días en escala local.
//
// `undefined` en `BorradorItem.recordatorio` y `null` no son lo mismo:
//   undefined → la propuesta no dice nada del recordatorio; si se está editando
//               un item real, el form carga el que ya tenga.
//   null      → la propuesta lo quita explícitamente (quitar_recordatorio), o el
//               item propuesto no lleva ninguno.
export interface RecordatorioBorrador {
  fechaLocal: string
  recurrencia: Recurrencia | null
  dias: number[]
}

// Un item propuesto pero todavía no guardado, con los campos ya en la forma que
// usa `ItemForm`. Es lo que permite "editar antes de guardar" / "editar antes de
// confirmar": la propuesta de la IA se abre en el formulario de siempre en vez de
// exigir guardar-y-después-corregir.
//
// Para un `create` no hay item detrás y el form lo trata como creación. Para un
// `update` el borrador viaja JUNTO al item real y describe CÓMO VA A QUEDAR
// —item actual + los cambios propuestos ya aplicados encima—, así el form abre
// en modo edición pero con la propuesta a la vista.
export interface BorradorItem {
  tipo: TipoItem
  /** Nombre del tema propuesto (existente o nuevo), no un id: la IA propone
   *  nombres y el form resuelve si ya existe o hay que crearlo. */
  temaNombre: string | null
  prioridad: Prioridad | null
  contenidoTexto: string
  /** Las líneas COMPLETAS (con su `hecho`), no sólo los textos: en un update
   *  sobre una lista, perder el marcado sería desmarcar todo al abrir el form. */
  lineas: LineaLista[]
  origen: OrigenItem
  recordatorio?: RecordatorioBorrador | null
}

function lineaNueva(texto: string): LineaLista {
  return { id: crypto.randomUUID(), texto, hecho: false }
}

// Convierte una acción propuesta en un borrador editable. La tabla se aplana al
// texto con pipes que el textarea sabe editar, por el mismo motivo que
// `contenidoDeAccionCrear`: el editor de grilla es el ítem 12.
export function borradorDeAccionCrear(accion: AccionCrear, origen: OrigenItem): BorradorItem {
  const contenido =
    accion.tipo === 'tabla' && accion.filas && accion.filas.length > 0
      ? tablaATexto(accion.columnas, accion.filas)
      : (accion.contenido ?? '')

  // El recordatorio propuesto se resuelve con la MISMA función que usa
  // `aplicarAccionCrear` (`fechaLocalDeAccion`), así lo que aparece prellenado en
  // el form es exactamente lo que se habría guardado al confirmar sin editar.
  const fechaLocal = fechaLocalDeAccion(accion)

  return {
    tipo: accion.tipo,
    temaNombre: accion.tema,
    prioridad: accion.prioridad,
    contenidoTexto: contenido,
    lineas: (accion.lineas ?? []).map(lineaNueva),
    origen,
    recordatorio: fechaLocal
      ? {
          fechaLocal,
          recurrencia: accion.recordatorio_recurrencia ?? null,
          dias: accion.recordatorio_dias ?? [],
        }
      : null,
  }
}

// Las líneas de una lista después de aplicarle los cambios propuestos. Es la
// misma cuenta que corre al confirmar una edición sin editarla (ver
// `applyAction` en AssistantDrawer, que la usa tal cual), y por eso vive acá:
// "editar antes de confirmar" tiene que abrir el form con exactamente lo que
// habría quedado guardado, no con una versión parecida.
export function lineasConCambios(
  actuales: LineaLista[],
  c: Pick<
    AccionEditar['cambios'],
    'lineas_agregar' | 'lineas_quitar' | 'lineas_marcar_hechas' | 'lineas_desmarcar'
  >,
): LineaLista[] {
  const norm = (s: string) => s.trim().toLowerCase()
  let lineas = actuales
  if (c.lineas_quitar) {
    const rm = new Set(c.lineas_quitar.map(norm))
    lineas = lineas.filter((l) => !rm.has(norm(l.texto)))
  }
  if (c.lineas_marcar_hechas) {
    const mk = new Set(c.lineas_marcar_hechas.map(norm))
    lineas = lineas.map((l) => (mk.has(norm(l.texto)) ? { ...l, hecho: true } : l))
  }
  if (c.lineas_desmarcar) {
    const dm = new Set(c.lineas_desmarcar.map(norm))
    lineas = lineas.map((l) => (dm.has(norm(l.texto)) ? { ...l, hecho: false } : l))
  }
  if (c.lineas_agregar) {
    lineas = [...lineas, ...c.lineas_agregar.map(lineaNueva)]
  }
  return lineas
}

// Las líneas guardadas de un item, normalizadas. Un item que no es lista (o que
// nunca tuvo líneas) devuelve [].
export function lineasDeItem(item: Item | null | undefined): LineaLista[] {
  const guardadas = item?.contenido?.items
  if (!Array.isArray(guardadas)) return []
  return (guardadas as LineaLista[]).map((l) => ({
    id: typeof l.id === 'string' ? l.id : crypto.randomUUID(),
    texto: String(l.texto ?? ''),
    hecho: Boolean(l.hecho),
  }))
}

/**
 * El borrador de una edición propuesta: el item REAL con los cambios de la IA ya
 * aplicados encima. Es lo que abre "Editar antes de confirmar" en el form.
 *
 * Cada campo sigue exactamente la regla que sigue `applyAction` al confirmar sin
 * editar —incluido el ida y vuelta de los días de UTC a la escala local— para
 * que abrir el form no cambie por sí solo nada de lo que se iba a guardar.
 *
 * @param existente el recordatorio que el item ya tiene, si tiene. Se necesita
 *   para completar lo que los cambios NO traen: "movelo a las 10" no puede
 *   perder el "todos los días" que ya estaba.
 */
export function borradorDeAccionEditar(
  accion: AccionEditar,
  item: Item | undefined,
  temaNombreActual: string | null,
  existente: Recordatorio | null,
): BorradorItem {
  const c = accion.cambios
  const tipo = c.tipo ?? item?.tipo ?? 'nota'

  const textoActual = typeof item?.contenido?.texto === 'string' ? item.contenido.texto : ''
  const contenidoTexto = c.contenido ?? textoActual

  const tocaLineas = Boolean(
    c.lineas_agregar || c.lineas_quitar || c.lineas_marcar_hechas || c.lineas_desmarcar,
  )
  const lineasActuales = lineasDeItem(item)
  const lineas = tocaLineas ? lineasConCambios(lineasActuales, c) : lineasActuales

  return {
    tipo,
    temaNombre: 'tema' in c ? (c.tema ?? null) : temaNombreActual,
    prioridad: c.prioridad !== undefined ? c.prioridad : (item?.prioridad ?? null),
    contenidoTexto,
    lineas,
    // El origen sólo se usa al CREAR (un update conserva el del item), pero el
    // tipo lo pide: 'texto' es de dónde salió esta propuesta.
    origen: 'texto',
    recordatorio: recordatorioDeCambios(c, existente),
  }
}

// El recordatorio que deja una edición propuesta, o `undefined` si la propuesta
// no lo toca (ahí el form carga el del item, como en cualquier edición manual).
function recordatorioDeCambios(
  c: AccionEditar['cambios'],
  existente: Recordatorio | null,
): RecordatorioBorrador | null | undefined {
  if (c.quitar_recordatorio) return null

  const tocaRecordatorio =
    Boolean(c.recordatorio_fecha_hora) ||
    Boolean(c.recordatorio_hora) ||
    c.recordatorio_recurrencia !== undefined
  if (!tocaRecordatorio) return undefined

  // Al pasar a "diario"/"días específicos" el asistente manda hora sola y la
  // fecha de arranque se recalcula, igual que en `applyAction`.
  const fechaLocal =
    c.recordatorio_hora && !c.recordatorio_fecha_hora
      ? proximaFechaConHora(c.recordatorio_hora)
      : (c.recordatorio_fecha_hora ??
        (existente ? isoToDatetimeLocal(existente.fecha_hora) : null))

  // Sin fecha (ni nueva ni previa) no hay recordatorio que armar: cambiar la
  // recurrencia de algo que no existe no es una acción sensata.
  if (!fechaLocal) return undefined

  const recurrencia =
    c.recordatorio_recurrencia !== undefined
      ? c.recordatorio_recurrencia
      : (existente?.recurrencia ?? null)

  // Los días propuestos vienen en escala local; los guardados están en UTC y hay
  // que devolverlos a local antes de mostrarlos, o mover la hora de un "lunes y
  // miércoles" correría los días.
  const dias =
    c.recordatorio_dias ??
    (existente?.recurrencia_dias
      ? diasUtcALocales(existente.recurrencia_dias, new Date(existente.fecha_hora))
      : [])

  return { fechaLocal, recurrencia, dias }
}

/**
 * Cómo quedó un item después de que el usuario ajustara y guardara una propuesta
 * desde el formulario. Es lo que viaja al modelo en el `functionResponse`: sin
 * esto, el historial le diría "aplicada" y él seguiría creyendo que lo guardado
 * son los args que propuso (ítem: editar antes de confirmar, punto 6).
 *
 * Puro a propósito —recibe el tema ya resuelto a nombre y el recordatorio ya
 * leído— para poder testearlo sin tocar IndexedDB ni Supabase.
 */
export function datosFinalesDeItem(
  item: Item,
  temaNombre: string | null,
  recordatorio: Recordatorio | null,
): Record<string, unknown> {
  const lineas = lineasDeItem(item)
  const texto = typeof item.contenido?.texto === 'string' ? item.contenido.texto : null

  return {
    item_id: item.id,
    tipo: item.tipo,
    tema: temaNombre,
    prioridad: item.prioridad,
    ...(lineas.length > 0
      ? { lineas: lineas.map((l) => ({ texto: l.texto, hecho: l.hecho })) }
      : { contenido: texto ?? '' }),
    recordatorio: recordatorio
      ? {
          fecha_hora: recordatorio.fecha_hora,
          recurrencia: recordatorio.recurrencia,
        }
      : null,
  }
}
