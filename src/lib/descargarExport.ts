// Exportar mis datos: la parte que toca el mundo — lee el espejo local
// (IndexedDB) y dispara la descarga. El armado de los formatos es puro y vive
// en `exportarDatos.ts` (ver el comentario de arriba de ese archivo).
//
// Lee de la misma caché que el resto de las pantallas, así que la exportación
// funciona sin conexión y sin pegarle a Supabase.

import { loadItemsFromCache, loadRecordatoriosFromCache, loadTemasFromCache } from './db'
import {
  armarDatosExport,
  construirCSV,
  construirJSON,
  type DatosExport,
  type UsuarioExport,
} from './exportarDatos'

export async function recolectarDatosExport(
  usuario: UsuarioExport = { email: null, nombre: null },
): Promise<DatosExport> {
  const [temas, items, recordatorios] = await Promise.all([
    loadTemasFromCache(),
    loadItemsFromCache(),
    loadRecordatoriosFromCache(),
  ])
  return armarDatosExport(temas, items, recordatorios, usuario)
}

function fechaArchivo(d = new Date()): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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
    construirJSON(datos),
    `organizador-datos-${fechaArchivo()}.json`,
    'application/json',
  )
}

export async function exportarCSV(): Promise<void> {
  const datos = await recolectarDatosExport()
  // BOM inicial: sin él, Excel en Windows interpreta el UTF-8 como Latin-1 y
  // las tildes/ñ salen rotas.
  descargar(
    '﻿' + construirCSV(datos),
    `organizador-datos-${fechaArchivo()}.csv`,
    'text/csv;charset=utf-8',
  )
}
