// Exportar mis datos: lectura del espejo local y disparo de la descarga.
// El armado de los formatos es puro y vive en `exportarDatos.ts`.
//
// ---------------------------------------------------------------------------
// POR QUÉ EL ARMADO Y LA DESCARGA ESTÁN SEPARADOS (y por qué las dos funciones
// de abajo son SINCRÓNICAS)
// ---------------------------------------------------------------------------
//
// Chrome trata como descarga "automática" —y la manda al gate de permiso, el
// "Necesita permiso para descargarse"— a toda descarga cuyo `click()` no salga
// del MISMO turno del event loop que el gesto del usuario. Si entre el click
// del botón y el `a.click()` hay un `await` (leer IndexedDB, por ejemplo), el
// click cae en un turno posterior y queda desasociado del gesto: la primera
// descarga de la pestaña pasa igual, pero la siguiente ya pide permiso.
//
// En localhost no se nota porque ese origen normalmente ya tiene el permiso
// concedido de tanto probar; en producción, con el perfil limpio, sí aparece.
//
// Por eso la parte async (`recolectarDatosExport`) se llama ANTES, al montar
// la pantalla, y `descargarJSON`/`descargarCSV` reciben los datos ya en
// memoria y llegan hasta `a.click()` sin un solo `await` de por medio.
//
// NO agregar `async`/`await` a `descargar`, `descargarJSON` ni `descargarCSV`.

import { loadItemsFromCache, loadRecordatoriosFromCache, loadTemasFromCache } from './db'
import {
  armarDatosExport,
  construirCSV,
  construirJSON,
  type DatosExport,
  type UsuarioExport,
} from './exportarDatos'

/** La parte async: se llama al montar la pantalla, NO dentro del click. */
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

// Cuánto se espera antes de soltar el object URL. Revocarlo en la línea
// siguiente al `click()` es una carrera conocida: si el revoke gana, la
// descarga sale vacía o directamente falla. Se libera después, cuando el
// navegador ya leyó el blob (que acá son unos pocos KB, así que retenerlo un
// rato no cuesta nada).
const REVOCAR_URL_MS = 30_000

// Dispara la descarga vía un <a download> temporal: no hay backend que sirva
// el archivo, así que arma el blob y lo "clickea" solo.
//
// Sincrónica a propósito — ver el comentario de arriba del archivo.
function descargar(contenido: string, nombre: string, tipoMime: string): void {
  const blob = new Blob([contenido], { type: tipoMime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOCAR_URL_MS)
}

export function descargarJSON(datos: DatosExport): void {
  // `generadoEn` se sella acá y no en la precarga: lo que importa es cuándo se
  // bajó el respaldo, no cuándo se abrió Ajustes.
  const sellado: DatosExport = { ...datos, generadoEn: new Date().toISOString() }
  descargar(construirJSON(sellado), `organizador-datos-${fechaArchivo()}.json`, 'application/json')
}

export function descargarCSV(datos: DatosExport): void {
  // BOM inicial: sin él, Excel en Windows interpreta el UTF-8 como Latin-1 y
  // las tildes/ñ salen rotas.
  descargar(
    '﻿' + construirCSV(datos),
    `organizador-datos-${fechaArchivo()}.csv`,
    'text/csv;charset=utf-8',
  )
}
