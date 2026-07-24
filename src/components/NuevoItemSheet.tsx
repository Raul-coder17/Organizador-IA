import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { deleteItem } from '../lib/repo'
import { loadTemasFromCache } from '../lib/db'
import { emitLocalChange, subscribeSyncSettled } from '../lib/sync'
import type { Item, Tema } from '../types/database'
import { ItemForm } from './ItemForm'

// Sheet de "+ Nuevo ítem" (PLAN_REDISEÑO.md ítem 11). Mismo criterio que el
// drawer del asistente (ítem 10): el `ItemForm` no se reescribe, sólo cambia de
// contenedor. Vive montado en el shell; el AppShell le maneja abrir/cerrar y el
// modo (menú de 3 opciones vs. formulario) y le pasa el ítem a editar.
//
//   ≥900px  modal centrado (~540px).
//   <900px  bottom-sheet que sube desde abajo.
// El breakpoint lo resuelven las media queries de index.css (el mismo 900 del
// resto). El telón (`.drawer-overlay`) se reusa tal cual del ítem 10.
//
// El sheet mismo dispara `emitLocalChange()` tras cada mutación (guardar, borrar,
// tema creado/recoloreado) para que las páginas de abajo relean el espejo local
// al instante — offline incluido, sin esperar a que un ciclo de sync settle. Es
// lo que antes hacía el `onSaved` directo del form inline en la Biblioteca.

type Vista = 'menu' | 'form'

interface NuevoItemSheetProps {
  open: boolean
  vista: Vista
  editingItem: Item | null
  /** Cambia para forzar un `ItemForm` limpio (tras cancelar/guardar, o al
   *  cambiar de ítem a editar). */
  formKey: number
  onElegirEscribir: () => void
  onPedirIA: () => void
  /** Escape, click en el telón o la X: cierra pero NO resetea (preserva el
   *  borrador, igual que el drawer). */
  onCerrarSuave: () => void
  /** Cancelar explícito o guardar con éxito: cierra Y deja el sheet limpio. */
  onResuelto: () => void
}

function IconoCerrar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function IconoEscribir() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M14 6l4 4" />
    </svg>
  )
}

function IconoFoto() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M3 8a1 1 0 0 1 1-1h2l1.4-2h7.2L16 7h2a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <circle cx="11" cy="12.5" r="3.2" />
    </svg>
  )
}

function IconoChispa() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" />
    </svg>
  )
}

export function NuevoItemSheet({
  open,
  vista,
  editingItem,
  formKey,
  onElegirEscribir,
  onPedirIA,
  onCerrarSuave,
  onResuelto,
}: NuevoItemSheetProps) {
  const { user } = useAuth()
  const [temas, setTemas] = useState<Tema[]>([])
  const [eliminando, setEliminando] = useState(false)
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null)

  // Los temas salen del espejo local (como el resto de la app) y se refrescan
  // cuando el sync avisa. Los cambios propios del form (tema creado / recoloreado)
  // se aplican directo en el estado de abajo.
  useEffect(() => {
    let cancelado = false
    const cargar = () =>
      loadTemasFromCache()
        .then((t) => {
          if (!cancelado) setTemas(t)
        })
        .catch(() => {
          /* lectura local best-effort */
        })
    cargar()
    const desuscribir = subscribeSyncSettled(cargar)
    return () => {
      cancelado = true
      desuscribir()
    }
  }, [])

  // Escape cierra (suave: preserva el borrador), como cualquier diálogo modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrarSuave()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCerrarSuave])

  if (!user) return null

  function handleTemaCreated(tema: Tema) {
    setTemas((prev) => [...prev, tema].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    emitLocalChange()
  }

  // El color de un tema existente ya está guardado cuando llega acá; se refleja
  // en el chip local y se avisa a las páginas.
  function handleTemaUpdated(tema: Tema) {
    setTemas((prev) => prev.map((t) => (t.id === tema.id ? tema : t)))
    emitLocalChange()
  }

  function handleSaved() {
    emitLocalChange()
    onResuelto()
  }

  async function handleEliminar() {
    if (!editingItem) return
    if (!confirm('¿Eliminar este item?')) return
    setEliminando(true)
    setErrorEliminar(null)
    try {
      await deleteItem(editingItem.id)
      emitLocalChange()
      onResuelto()
    } catch (err) {
      setErrorEliminar(err instanceof Error ? err.message : 'No se pudo eliminar el item.')
    } finally {
      setEliminando(false)
    }
  }

  const titulo = editingItem ? 'Editar ítem' : 'Nuevo ítem'

  return (
    <>
      <div
        className={`drawer-overlay${open ? ' drawer-overlay--open' : ''}`}
        onClick={onCerrarSuave}
        aria-hidden="true"
      />
      <div
        className={`nuevo-sheet${open ? ' nuevo-sheet--open' : ''}`}
        role="dialog"
        aria-modal={open || undefined}
        aria-label={titulo}
        aria-hidden={!open}
      >
        <header className="nuevo-sheet__head">
          <span className="nuevo-sheet__title">{titulo}</span>
          <button type="button" className="icon-btn" onClick={onCerrarSuave} aria-label="Cerrar">
            <IconoCerrar />
          </button>
        </header>

        <div className="nuevo-sheet__body">
          {vista === 'menu' ? (
            <div className="sheet-opciones">
              <button type="button" className="sheet-opcion" onClick={onElegirEscribir}>
                <span className="sheet-opcion__icon">
                  <IconoEscribir />
                </span>
                <span className="sheet-opcion__texto">
                  <span className="sheet-opcion__label">Escribir</span>
                  <span className="sheet-opcion__desc">Nota, lista, tabla o recordatorio, a mano.</span>
                </span>
              </button>

              {/* Visible pero apagada: la captura por foto es el ítem 14 y no
                  existe. Mismo criterio que el buscador (ítem 7) y el FOTO de Hoy
                  (ítem 8): se muestra el lugar de la función y se dice por qué no
                  se puede tocar todavía, en vez de esconderla. */}
              <button
                type="button"
                className="sheet-opcion sheet-opcion--off"
                disabled
                title="La captura por foto todavía no está construida"
              >
                <span className="sheet-opcion__icon">
                  <IconoFoto />
                </span>
                <span className="sheet-opcion__texto">
                  <span className="sheet-opcion__label">Desde una foto</span>
                  <span className="sheet-opcion__desc">Todavía no está construida — llega más adelante.</span>
                </span>
              </button>

              <button type="button" className="sheet-opcion" onClick={onPedirIA}>
                <span className="sheet-opcion__icon">
                  <IconoChispa />
                </span>
                <span className="sheet-opcion__texto">
                  <span className="sheet-opcion__label">Pedirle a la IA</span>
                  <span className="sheet-opcion__desc">Describilo en palabras y te propone el ítem.</span>
                </span>
              </button>
            </div>
          ) : (
            <>
              <ItemForm
                key={formKey}
                userId={user.id}
                temas={temas}
                editingItem={editingItem}
                onSaved={handleSaved}
                onCancel={onResuelto}
                onTemaCreated={handleTemaCreated}
                onTemaUpdated={handleTemaUpdated}
              />

              {/* Eliminar vive acá, en el modo edición, con la misma confirmación
                  que la ficha de la Biblioteca (task 3). Separado del bloque
                  Guardar/Cancelar del form y en tono destructivo. */}
              {editingItem && (
                <div className="sheet-eliminar">
                  {errorEliminar && <p className="text-sm text-rust mb-2">{errorEliminar}</p>}
                  <button
                    type="button"
                    onClick={handleEliminar}
                    disabled={eliminando}
                    className="btn-eliminar"
                  >
                    {eliminando ? 'Eliminando…' : 'Eliminar ítem'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
