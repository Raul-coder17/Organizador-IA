import { supabase } from './supabase'
import { isoToDatetimeLocal } from './recordatorios'
import type { PhotoExtractResponse } from '../types/assistant'
import type { Tema } from '../types/database'

// Captura de item por foto (PLAN_REDISEÑO.md ítem 14), lado cliente.
//
// LA FOTO NO SE GUARDA. No va a Supabase Storage, no se escribe en IndexedDB ni
// queda en el outbox: se lee del `<input type="file">`, se achica en memoria, se
// manda a la Edge Function, y el `File`/canvas quedan libres al terminar. Lo
// único que persiste es el item que el usuario confirma. Que la foto sea un
// medio y no un dato es una decisión, no un olvido — evita tener que resolver
// cuotas de storage, borrado y sincronización de binarios en una app que hoy
// sincroniza sólo texto.

// Lado mayor al que se achica la foto antes de mandarla.
//
// 1600px es el punto donde una foto de recibo o de lista escrita a mano todavía
// se lee bien y el payload baja de varios MB a un par de cientos de KB. Importa
// por tres motivos a la vez: el body de una Edge Function tiene tope, base64
// infla un 33% más, y Gemini cobra la imagen por tokens según su tamaño. Subirlo
// no mejora la lectura de un texto que ya es legible a 1600px.
const LADO_MAXIMO = 1600
const CALIDAD_JPEG = 0.82

export interface FotoPreparada {
  base64: string
  mimeType: string
  /** Data URL lista para dibujar la miniatura mientras se analiza. */
  dataUrl: string
}

// Achica y recomprime la imagen con un canvas. Si algo del camino no está
// disponible (un navegador viejo, un formato que el decoder no soporta),
// devolvemos el archivo original en base64: es preferible mandar una foto grande
// que no poder usar la función.
export async function prepararFoto(file: File): Promise<FotoPreparada> {
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
    const ancho = Math.round(bitmap.width * escala)
    const alto = Math.round(bitmap.height * escala)

    const canvas = document.createElement('canvas')
    canvas.width = ancho
    canvas.height = alto
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('sin contexto 2d')
    ctx.drawImage(bitmap, 0, 0, ancho, alto)
    bitmap.close()

    // Siempre JPEG: es lo que mejor comprime una foto y evita mandar un PNG de
    // varios MB por una captura de pantalla.
    const dataUrl = canvas.toDataURL('image/jpeg', CALIDAD_JPEG)
    const base64 = dataUrl.split(',')[1] ?? ''
    if (!base64) throw new Error('canvas vacío')
    return { base64, mimeType: 'image/jpeg', dataUrl }
  } catch {
    const dataUrl = await leerComoDataUrl(file)
    const base64 = dataUrl.split(',')[1] ?? ''
    const mimeType = file.type || 'image/jpeg'
    return { base64, mimeType, dataUrl }
  }
}

function leerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Manda la foto a `extract-from-photo` y devuelve la propuesta.
 *
 * Los errores vuelven como `Error` con el mensaje YA en español: la Edge
 * Function traduce todo lo de Gemini (cuota, key inválida, servicio caído) y acá
 * sólo se rescata ese texto del body, igual que hace el asistente. No se
 * inventan mensajes nuevos para casos que el server ya sabe explicar.
 */
export async function extraerDeFoto(foto: FotoPreparada, temas: Tema[]): Promise<PhotoExtractResponse> {
  const { data, error } = await supabase.functions.invoke<PhotoExtractResponse>('extract-from-photo', {
    body: {
      imagen_base64: foto.base64,
      mime_type: foto.mimeType,
      // Los temas que el usuario ya tiene, para que Gemini reuse uno en vez de
      // inventar un sinónimo. Sólo los nombres: no hace falta mandar ids ni
      // colores a un modelo que sólo tiene que elegir una etiqueta.
      temas: temas.map((t) => t.nombre),
      client_now: isoToDatetimeLocal(new Date().toISOString()),
    },
  })

  if (error || !data) {
    // supabase-js descarta el body en error.message y sólo deja "non-2xx status
    // code". Leemos error.context (la Response cruda) para tomar el { error } de
    // la función, que ya viene traducido al español desde el server.
    let real = 'No se pudo contactar al servicio de lectura de fotos. Intentá de nuevo.'
    const ctx = (error as { context?: Response } | undefined)?.context
    if (ctx && typeof ctx.clone === 'function') {
      try {
        const body = await ctx.clone().json()
        if (typeof body?.error === 'string') real = body.error
      } catch {
        /* sin body JSON legible: dejamos el mensaje genérico en español */
      }
    }
    console.error('[extract-from-photo] error real:', real, error)
    throw new Error(real)
  }

  return data
}
