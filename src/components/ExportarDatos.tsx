import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { descargarCSV, descargarJSON, recolectarDatosExport } from '../lib/descargarExport'
import { subscribeLocalChange, subscribeSyncSettled } from '../lib/sync'
import type { DatosExport } from '../lib/exportarDatos'

// Exportar mis datos: respaldo local, sin red (lee del mismo espejo local que
// el resto de la app). Va antes que "Borrar cuenta" a propósito: es lo
// contrario de destructivo, así que no comparte bloque con esa acción.
//
// El respaldo se arma AL MONTAR, no al apretar el botón. No es una
// optimización: Chrome manda al gate de permiso ("Necesita permiso para
// descargarse") las descargas cuyo click no sale del mismo turno del gesto,
// y un `await` a IndexedDB en el medio alcanza para eso. Precargando, el
// handler del click queda 100% sincrónico hasta el `a.click()`. Ver el
// comentario largo en `descargarExport.ts`.
export function ExportarDatos() {
  const { user, nombre } = useAuth()
  // En un ref y no en estado: lo lee el handler del click, que tiene que ser
  // sincrónico, y no hay nada que redibujar cuando cambia.
  const datosRef = useRef<DatosExport | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando')
  const [intento, setIntento] = useState(0)

  const email = user?.email ?? null

  useEffect(() => {
    let cancelado = false

    async function cargar() {
      try {
        const datos = await recolectarDatosExport({ email, nombre })
        if (cancelado) return
        datosRef.current = datos
        setEstado('listo')
      } catch {
        if (cancelado) return
        datosRef.current = null
        setEstado('error')
      }
    }

    cargar()

    // El espejo puede cambiar con Ajustes abierto —una edición en otra
    // pestaña, o un ciclo de sync que trae datos nuevos—, y un respaldo viejo
    // es peor que uno que tarda un instante más en estar listo.
    const desuscribirLocal = subscribeLocalChange(cargar)
    const desuscribirSettled = subscribeSyncSettled(cargar)

    return () => {
      cancelado = true
      desuscribirLocal()
      desuscribirSettled()
    }
  }, [email, nombre, intento])

  // SINCRÓNICA de punta a punta: sin `async`, sin `await`, sin promesas. Es
  // la condición para que Chrome cuente la descarga como iniciada por el
  // usuario. Ver el comentario de arriba.
  function exportar(formato: 'json' | 'csv') {
    const datos = datosRef.current
    if (!datos) return
    if (formato === 'json') descargarJSON(datos)
    else descargarCSV(datos)
  }

  const listo = estado === 'listo'

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-ink">Exportar mis datos</p>
        <p className="text-xs text-ink-soft mt-1">
          Descarga una copia de tus items, temas y recordatorios guardados en este dispositivo.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => exportar('json')}
          disabled={!listo}
          className="btn-outline"
        >
          Exportar JSON
        </button>
        <button
          type="button"
          onClick={() => exportar('csv')}
          disabled={!listo}
          className="btn-outline"
        >
          Exportar CSV
        </button>
      </div>

      {estado === 'cargando' && <p className="text-xs text-ink-soft">Preparando el respaldo…</p>}

      {estado === 'error' && (
        <div className="space-y-2">
          <p className="text-sm text-rust">
            No se pudieron leer los datos guardados en este dispositivo.
          </p>
          <button
            type="button"
            onClick={() => {
              setEstado('cargando')
              setIntento((n) => n + 1)
            }}
            className="btn-outline"
          >
            Reintentar
          </button>
        </div>
      )}
    </div>
  )
}
