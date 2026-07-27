import { useEffect, useState } from 'react'
import { updateTemaColor } from '../lib/repo'
import { colorDeTema, type TemaColor } from '../lib/temaColores'
import { borrarTemaConConfirmacion } from '../lib/temaAcciones'
import type { Tema } from '../types/database'
import { TemaColorSwatches } from './TemaColorPicker'

// Entrada directa a "cambiar color" / "borrar tema" desde el chip de un tema
// en Biblioteca (ítem "Gestión de temas desde Biblioteca",
// PLAN_ORGANIZADOR.md) — hasta ahora sólo existía dentro de ItemForm. Mismo
// patrón visual que NuevoItemSheet: modal centrado (≥900px) / bottom-sheet
// (<900px), resuelto por las media queries de index.css, reusando el telón
// `.drawer-overlay`. La lógica (color y borrado) es la misma que ItemForm —
// vive en TemaColorPicker.tsx, no se duplica acá.
//
// Se mantiene montado con `tema` en null y sólo se anima con la clase
// `--open`, igual que los demás sheets: así la transición de cierre no se
// corta a mitad de camino.

interface TemaOpcionesMenuProps {
  tema: Tema | null
  onClose: () => void
  onUpdated: (tema: Tema) => void
  onDeleted: (temaId: string) => void
}

function IconoCerrar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function TemaOpcionesMenu({ tema, onClose, onUpdated, onDeleted }: TemaOpcionesMenuProps) {
  const [error, setError] = useState<string | null>(null)
  const open = tema !== null

  // Un error de un tema no debe sobrevivir para el próximo que se abra.
  useEffect(() => {
    setError(null)
  }, [tema?.id])

  async function handleColorClick(color: TemaColor) {
    if (!tema) return
    try {
      onUpdated(await updateTemaColor(tema.id, color))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el color del tema')
    }
  }

  async function handleDelete() {
    if (!tema) return
    try {
      const borrado = await borrarTemaConConfirmacion(tema)
      if (!borrado) return
      onDeleted(tema.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar el tema')
    }
  }

  return (
    <>
      <div
        className={`drawer-overlay${open ? ' drawer-overlay--open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`tema-opciones-sheet${open ? ' tema-opciones-sheet--open' : ''}`}
        role="dialog"
        aria-modal={open || undefined}
        aria-label={tema ? `Opciones del tema "${tema.nombre}"` : undefined}
        aria-hidden={!open}
      >
        <header className="tema-opciones-sheet__head">
          <span className="tema-opciones-sheet__title">{tema?.nombre ?? ''}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <IconoCerrar />
          </button>
        </header>

        <div className="tema-opciones-sheet__body">
          {tema && (
            <>
              <p className="label">Cambiar color</p>
              <TemaColorSwatches activo={colorDeTema(tema)} onSelect={handleColorClick} />
              {error && <p className="text-sm text-rust">{error}</p>}
              <button type="button" onClick={handleDelete} className="tema-borrar">
                Borrar tema “{tema.nombre}”
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
