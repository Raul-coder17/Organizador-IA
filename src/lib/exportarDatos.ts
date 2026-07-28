// Exportar mis datos (Ajustes → Cuenta): respaldo local en JSON o CSV.
//
// Lee del mismo espejo local (IndexedDB) que el resto de la app — no pide red
// ni pasa por Supabase — así que funciona offline igual que todas las
// pantallas que leen de `db.ts`.
//
// Dos formatos con objetivos distintos:
//   - JSON: fidelidad completa. Cada item con su(s) recordatorio(s) anidados y
//     agrupado por tema (no un dump de las tres tablas sueltas).
//   - CSV: una fila por item, aplanada a propósito — no intenta cargar la
//     estructura anidada de una lista o una tabla en una celda, así que usa el
//     mismo resumen legible que ya arma `resumenContenido` para las
//     notificaciones.

import { loadItemsFromCache, loadRecordatoriosFromCache, loadTemasFromCache } from './db'
import { resumenContenido } from './notificacionRecordatorio'
import { marcaRecurrencia } from './recurrencia'
import type { Item, Recordatorio } from '../types/database'

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
  resumen: string
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
    resumen: resumenContenido(item),
    contenido: item.contenido,
    creadoEn: item.created_at,
    actualizadoEn: item.updated_at,
    recordatorios: recordatorios.map(aRecordatorioExport),
  }
}

// Junta temas + items + recordatorios del espejo local y arma la estructura
// anidada que consumen `construirJSON`/`construirCSV`. Separado de la
// descarga en sí para poder testearlo sin tocar el DOM.
export async function recolectarDatosExport(
  usuario: UsuarioExport = { email: null, nombre: null },
): Promise<DatosExport> {
  const [temas, items, recordatorios] = await Promise.all([
    loadTemasFromCache(),
    loadItemsFromCache(),
    loadRecordatoriosFromCache(),
  ])

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
    generadoEn: new Date().toISOString(),
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

function fechaArchivo(d = new Date()): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// dd/mm/yyyy hh:mm a mano y no `toLocaleString`: el `dateStyle: 'short'` de
// es-AR trunca el año a 2 dígitos y mete una coma en medio del valor, que
// después hay que escapar en el CSV. Un formato fijo evita las dos cosas.
function fechaLegible(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`
}

// Dispara la descarga vía un <a download> temporal: no hay backend que sirva
// el archivo, así que arma el blob y lo "clickea" solo.
function descargar(contenido: string, nombre: string, tipoMime: string): void {
  const blob = new Blob([contenido], { type: tipoMime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function exportarJSON(usuario: UsuarioExport): Promise<void> {
  const datos = await recolectarDatosExport(usuario)
  descargar(
    JSON.stringify(datos, null, 2),
    `organizador-datos-${fechaArchivo()}.json`,
    'application/json',
  )
}

const CABECERAS_CSV = ['Tipo', 'Tema', 'Prioridad', 'Contenido', 'Creado', 'Recordatorio']

// Separador `;` y no `,`: en Excel en español la coma es el separador
// decimal, así que un CSV con comas se abre entero en una sola columna. Con
// `;` se abre bien sin pasos extra, que es justo el objetivo acá.
const SEPARADOR_CSV = ';'

function celdaCSV(valor: string): string {
  const limpio = valor.replace(/\r?\n/g, ' / ')
  if (limpio.includes(SEPARADOR_CSV) || limpio.includes('"') || limpio.includes(',')) {
    return `"${limpio.replace(/"/g, '""')}"`
  }
  return limpio
}

function recordatoriosCSV(recs: RecordatorioExport[]): string {
  if (recs.length === 0) return ''
  return recs
    .map((r) => `${fechaLegible(r.fechaHora)} (${r.estado}${r.repite ? `, ${r.repite}` : ''})`)
    .join(' / ')
}

function filaCSV(item: ItemExport, temaNombre: string): string[] {
  return [
    item.tipo,
    temaNombre,
    item.prioridad ?? '',
    item.resumen,
    fechaLegible(item.creadoEn),
    recordatoriosCSV(item.recordatorios),
  ]
}

export async function exportarCSV(): Promise<void> {
  const datos = await recolectarDatosExport()

  const filas: string[][] = []
  for (const tema of datos.temas) {
    for (const item of tema.items) filas.push(filaCSV(item, tema.nombre))
  }
  for (const item of datos.itemsSinTema) filas.push(filaCSV(item, 'Sin tema'))

  const lineas = [CABECERAS_CSV, ...filas].map((fila) =>
    fila.map(celdaCSV).join(SEPARADOR_CSV),
  )
  // BOM inicial: sin él, Excel en Windows a veces interpreta el UTF-8 como
  // Latin-1 y las tildes/ñ salen rotas.
  descargar(
    '﻿' + lineas.join('\r\n'),
    `organizador-datos-${fechaArchivo()}.csv`,
    'text/csv;charset=utf-8',
  )
}
