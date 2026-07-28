import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { exportarCSV, exportarJSON } from '../lib/exportarDatos'

// Exportar mis datos: respaldo local, sin red (lee del mismo espejo local que
// el resto de la app). Va antes que "Borrar cuenta" a propósito: es lo
// contrario de destructivo, así que no comparte bloque con esa acción.
export function ExportarDatos() {
  const { user, nombre } = useAuth()
  const [exportando, setExportando] = useState<'json' | 'csv' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function manejar(formato: 'json' | 'csv') {
    setExportando(formato)
    setError(null)
    try {
      if (formato === 'json') {
        await exportarJSON({ email: user?.email ?? null, nombre })
      } else {
        await exportarCSV()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo exportar los datos.')
    } finally {
      setExportando(null)
    }
  }

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
          onClick={() => manejar('json')}
          disabled={exportando !== null}
          className="btn-outline"
        >
          {exportando === 'json' ? 'Exportando…' : 'Exportar JSON'}
        </button>
        <button
          type="button"
          onClick={() => manejar('csv')}
          disabled={exportando !== null}
          className="btn-outline"
        >
          {exportando === 'csv' ? 'Exportando…' : 'Exportar CSV'}
        </button>
      </div>

      {error && <p className="text-sm text-rust">{error}</p>}
    </div>
  )
}
