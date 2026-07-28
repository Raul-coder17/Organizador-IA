// Exportar mis datos (Ajustes → Cuenta): armado de los dos formatos.
//
// Este archivo es PURO — no toca IndexedDB ni el DOM. La lectura del espejo
// local y la descarga en sí viven en `descargarExport.ts`; acá sólo se
// transforma. La separación es la misma que ya tienen
// `notificacionRecordatorio.ts` (separado de `recordatorios.ts`) y
// `reminderScheduling.ts` (de `useLocalReminderWatcher.ts`), y por el mismo
// motivo: así el armado se puede testear con `deno test` sin arrastrar `idb`
// ni `document`, que no existen bajo Deno.
//
// Dos formatos con objetivos distintos:
//   - JSON: fidelidad completa. Agrupado por tema, con los recordatorios
//     anidados dentro de su item y el `contenido` crudo tal cual lo guarda la
//     base — un respaldo no puede perder nada.
//   - CSV: una fila por item, aplanado a propósito para abrirse bien en
//     Excel/Sheets. Aplanado NO quiere decir recortado: el contenido va
//     entero (ver `contenidoLegible`), sólo que como texto en una celda en
//     vez de como estructura.

import { leerTabla } from './tabla'
import { marcaRecurrencia } from './recurrencia'
import type { Item, Recordatorio, Tema } from '../types/database'

export interface UsuarioExport {
  email: string | null
  nombre: string | null
}

interface RecordatorioExport {
  id: string
  fechaHora: string
  estado: Recordatorio['estado']
  recurrencia: Recordatorio['recurrencia']
  recurrenciaDias: number[] | null
  repite: string | null
}

interface ItemExport {
  id: string
  tipo: Item['tipo']
  prioridad: Item['prioridad']
  origen: Item['origen']
  /** El contenido volcado a texto plano legible (ver `contenidoLegible`). */
  contenidoTexto: string
  /** El jsonb crudo, tal cual la base. Es lo que hace del JSON un respaldo. */
  contenido: Record<string, unknown>
  creadoEn: string
  actualizadoEn: string
  recordatorios: RecordatorioExport[]
}

interface TemaExport {
  id: string
  nombre: string
  color: string
  creadoEn: string
  items: ItemExport[]
}

export interface DatosExport {
  generadoEn: string
  usuario: UsuarioExport
  temas: TemaExport[]
  itemsSinTema: ItemExport[]
}

/**
 * El contenido de un item volcado a texto plano, COMPLETO.
 *
 * No reusa `resumenContenido` (el de las notificaciones) a propósito: ese
 * está pensado para un título de una línea y de una tabla devuelve sólo los
 * encabezados y cuántas filas tiene ("Categoría · Detalle (16 filas)"). En un
 * respaldo eso es justo lo que no se puede perder.
 *
 * Los saltos de línea que mete acá son deliberados: el CSV quotea el campo,
 * así que la tabla entra entera en UNA celda y Excel/Sheets la muestran
 * multilínea, sin correr ninguna columna.
 */
export function contenidoLegible(item: Pick<Item, 'tipo' | 'contenido'>): string {
  const c = item.contenido ?? {}

  // Tabla: encabezados + TODAS las filas, una por línea, celdas con " | ".
  if (item.tipo === 'tabla') {
    const tabla = leerTabla(c)
    if (tabla) {
      const filas = tabla.headers ? [tabla.headers, ...tabla.rows] : tabla.rows
      return filas.map((f) => f.join(' | ')).join('\n')
    }
  }

  // Lista: una línea por ítem, marcando lo hecho. Se conserva el estado
  // porque una lista de compras a medio tachar sin las marcas es otra lista.
  if (item.tipo === 'lista' && Array.isArray(c.items)) {
    const lineas = c.items as { texto?: unknown; hecho?: unknown }[]
    return lineas.map((l) => `${l.hecho ? '[x]' : '[ ]'} ${String(l.texto ?? '')}`).join('\n')
  }

  if (typeof c.texto === 'string' && c.texto.trim()) return c.texto.trim()

  // Último recurso: el jsonb crudo. Feo, pero no pierde nada.
  return JSON.stringify(c)
}

function aRecordatorioExport(r: Recordatorio): RecordatorioExport {
  return {
    id: r.id,
    fechaHora: r.fecha_hora,
    estado: r.estado,
    recurrencia: r.recurrencia,
    recurrenciaDias: r.recurrencia_dias,
    repite: marcaRecurrencia(r)?.titulo ?? null,
  }
}

function aItemExport(item: Item, recordatorios: Recordatorio[]): ItemExport {
  return {
    id: item.id,
    tipo: item.tipo,
    prioridad: item.prioridad,
    origen: item.origen,
    contenidoTexto: contenidoLegible(item),
    contenido: item.contenido,
    creadoEn: item.created_at,
    actualizadoEn: item.updated_at,
    recordatorios: recordatorios.map(aRecordatorioExport),
  }
}

/**
 * Cruza las tres tablas del espejo local en la estructura anidada que
 * consumen los dos formatos: cada item dentro de su tema y con sus
 * recordatorios adentro, en vez de tres arrays sueltos que haya que volver a
 * cruzar a mano.
 */
export function armarDatosExport(
  temas: Tema[],
  items: Item[],
  recordatorios: Recordatorio[],
  usuario: UsuarioExport,
  generadoEn = new Date().toISOString(),
): DatosExport {
  const recordatoriosPorItem = new Map<string, Recordatorio[]>()
  for (const r of recordatorios) {
    const lista = recordatoriosPorItem.get(r.item_id) ?? []
    lista.push(r)
    recordatoriosPorItem.set(r.item_id, lista)
  }

  const itemsPorTema = new Map<string, Item[]>()
  const itemsSinTema: Item[] = []
  for (const item of items) {
    if (item.tema_id) {
      const lista = itemsPorTema.get(item.tema_id) ?? []
      lista.push(item)
      itemsPorTema.set(item.tema_id, lista)
    } else {
      itemsSinTema.push(item)
    }
  }

  return {
    generadoEn,
    usuario,
    temas: temas.map((t) => ({
      id: t.id,
      nombre: t.nombre,
      color: t.color,
      creadoEn: t.created_at,
      items: (itemsPorTema.get(t.id) ?? []).map((i) =>
        aItemExport(i, recordatoriosPorItem.get(i.id) ?? []),
      ),
    })),
    itemsSinTema: itemsSinTema.map((i) => aItemExport(i, recordatoriosPorItem.get(i.id) ?? [])),
  }
}

export function construirJSON(datos: DatosExport): string {
  return JSON.stringify(datos, null, 2)
}

// ============================================================
// CSV
// ============================================================

const CABECERAS_CSV = ['Tipo', 'Tema', 'Prioridad', 'Contenido', 'Creado', 'Recordatorio']

// Separador `;` y no `,`: en Excel en español la coma es el separador
// decimal, así que un CSV con comas se abre entero en una sola columna. Con
// `;` se abre bien sin pasos extra, que es justo el objetivo acá.
const SEPARADOR_CSV = ';'

// Fin de fila del CSV. RFC 4180 pide CRLF, y es lo que Excel espera.
const FIN_LINEA_CSV = '\r\n'

/**
 * Un campo escapado según RFC 4180: si contiene el separador, comillas o un
 * salto de línea, va entre comillas dobles, y las comillas de adentro se
 * duplican.
 *
 * El CR pelado (`\r` sin `\n`) es el que rompía: la versión anterior
 * normalizaba con `/\r?\n/`, que EXIGE el `\n`, y tampoco lo contaba entre los
 * caracteres que obligan a quotear — así que salía crudo al archivo y Excel lo
 * leía como fin de fila, partiendo la línea al medio y corriendo todas las
 * columnas de ahí en adelante. Acá se normaliza cualquier variante a `\n` y
 * después se quotea, que además preserva el salto en vez de destruirlo.
 */
export function celdaCSV(valor: string): string {
  const limpio = valor.replace(/\r\n?/g, '\n')
  // La coma no es nuestro separador, pero se quotea igual: algunos lectores
  // (Sheets entre ellos) la sniffean para adivinar el separador del archivo.
  return /[;",\n]/.test(limpio) ? `"${limpio.replace(/"/g, '""')}"` : limpio
}

/** dd/mm/aaaa hh:mm. A mano y no `toLocaleString`: el `dateStyle: 'short'` de
 *  es-AR trunca el año a 2 dígitos y mete una coma en medio del valor. */
export function fechaLegible(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`
}

function recordatoriosCSV(recs: RecordatorioExport[]): string {
  return recs
    .map((r) => `${fechaLegible(r.fechaHora)} (${r.estado}${r.repite ? `, ${r.repite}` : ''})`)
    .join('\n')
}

function filaCSV(item: ItemExport, temaNombre: string): string[] {
  return [
    item.tipo,
    temaNombre,
    item.prioridad ?? '',
    item.contenidoTexto,
    fechaLegible(item.creadoEn),
    recordatoriosCSV(item.recordatorios),
  ]
}

export function construirCSV(datos: DatosExport): string {
  const filas: string[][] = []
  for (const tema of datos.temas) {
    for (const item of tema.items) filas.push(filaCSV(item, tema.nombre))
  }
  for (const item of datos.itemsSinTema) filas.push(filaCSV(item, 'Sin tema'))

  return [CABECERAS_CSV, ...filas]
    .map((fila) => fila.map(celdaCSV).join(SEPARADOR_CSV))
    .join(FIN_LINEA_CSV)
}
