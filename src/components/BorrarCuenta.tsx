import { useEffect, useRef, useState } from 'react'
import { useSyncStatus } from '../lib/useSyncStatus'
import {
  PALABRA_CONFIRMACION,
  borrarCuenta,
  confirmacionValida,
} from '../lib/borrarCuenta'

// Borrar cuenta: el bloque destructivo de Ajustes y su diálogo de confirmación.
//
// Es la única acción de la app sin vuelta atrás, y el diseño lo trata como tal:
//
// · No alcanza con un "¿estás seguro?". Un botón de confirmar que ya está
//   habilitado se aprieta por inercia, y la mano es más rápida que la lectura.
//   Acá hay que ESCRIBIR la palabra exacta, así que el botón final sólo se
//   enciende después de un gesto que exige haber entendido qué se está
//   haciendo. Es fricción, y es a propósito.
// · Se dice qué se borra, con nombre, antes de pedir la palabra. "Se borrará tu
//   cuenta" no es información; la lista sí.
// · Sin conexión el botón se apaga y se explica por qué, igual que el resto de
//   Ajustes (guardar el nombre, activar la IA): el borrado vive en el servidor,
//   así que sin red no hay nada que encolar ni forma honesta de prometerlo.
export function BorrarCuenta() {
  const { online } = useSyncStatus()
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const habilitado = confirmacionValida(texto)

  function abrir() {
    setTexto('')
    setError(null)
    setAbierto(true)
  }

  // Cerrar es siempre la salida barata: durante el borrado NO, para no dejar la
  // pantalla como si nada estuviera pasando mientras el pedido viaja.
  function cerrar() {
    if (borrando) return
    setAbierto(false)
  }

  // Escape cierra, como cualquier diálogo modal (mismo criterio que el sheet de
  // nuevo ítem y el drawer del asistente).
  useEffect(() => {
    if (!abierto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, borrando])

  // El foco entra al campo de confirmación: es lo único que hay que hacer acá,
  // y quien navega con teclado no tiene por qué buscarlo.
  useEffect(() => {
    if (abierto) inputRef.current?.focus()
  }, [abierto])

  async function confirmar() {
    if (!habilitado || borrando) return
    setBorrando(true)
    setError(null)

    try {
      const { avisos } = await borrarCuenta()
      // A partir de acá la cuenta no existe: el signOut de `borrarCuenta` ya
      // disparó el vuelco al login y esta pantalla se está desmontando. Si la
      // limpieza local dejó algo pendiente, se avisa por el único canal que
      // sobrevive al desmonte.
      if (avisos.length > 0) window.alert(avisos.join('\n'))
    } catch (e) {
      // El servidor no borró nada: la cuenta sigue viva y el diálogo se queda
      // abierto con el error, para poder reintentar sin volver a tipear todo.
      setBorrando(false)
      setError(e instanceof Error ? e.message : 'No se pudo borrar la cuenta.')
    }
  }

  return (
    <>
      <div className="space-y-3">
        <div>
          <p className="text-sm text-ink">Borrar cuenta</p>
          <p className="text-xs text-ink-soft mt-1">
            Elimina tu cuenta y todo lo que guardaste. No se puede deshacer.
          </p>
        </div>

        <button type="button" onClick={abrir} disabled={!online} className="btn-rust">
          Borrar cuenta
        </button>

        {!online && (
          <p className="text-xs text-ink-soft">
            Sin conexión — borrar la cuenta se hace en el servidor, así que hace falta señal.
          </p>
        )}
      </div>

      {/* Telón: mismo `.drawer-overlay` que el resto de los modales. Click
          afuera cierra, salvo mientras se está borrando. */}
      <div
        className={`drawer-overlay${abierto ? ' drawer-overlay--open' : ''}`}
        onClick={cerrar}
        aria-hidden="true"
      />
      <div
        className={`confirm-modal${abierto ? ' confirm-modal--open' : ''}`}
        role="dialog"
        aria-modal={abierto || undefined}
        aria-labelledby="borrarCuentaTitulo"
        aria-hidden={!abierto}
      >
        <header className="confirm-modal__head">
          <span className="confirm-modal__title" id="borrarCuentaTitulo">
            Borrar cuenta
          </span>
        </header>

        <div className="confirm-modal__body">
          <p className="text-sm text-ink">
            Esto es <strong>irreversible</strong>. No hay papelera ni forma de recuperarlo después.
          </p>

          <p className="text-sm text-ink-soft">Se borra para siempre:</p>
          <ul className="confirm-modal__lista">
            <li>Todos tus ítems: notas, listas, tablas y recordatorios.</li>
            <li>Todos tus temas.</li>
            <li>Tu configuración de IA, incluida la API key guardada.</li>
            <li>Las notificaciones push de todos tus dispositivos.</li>
            <li>Tu usuario y tu correo — vas a poder registrarte de nuevo, pero vacío.</li>
          </ul>
          <p className="text-sm text-ink-soft">
            También se borran los datos guardados en este dispositivo.
          </p>

          <div className="confirm-modal__campo">
            <label className="label" htmlFor="confirmarBorrado">
              Escribí <span className="font-mono text-rust">{PALABRA_CONFIRMACION}</span> para
              confirmar
            </label>
            <input
              id="confirmarBorrado"
              ref={inputRef}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              disabled={borrando}
              className="ctl ctl--mono w-full"
              placeholder={PALABRA_CONFIRMACION}
            />
          </div>

          {error && <p className="text-sm text-rust">{error}</p>}
        </div>

        <footer className="confirm-modal__pie">
          <button type="button" onClick={cerrar} disabled={borrando} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={!habilitado || borrando}
            className="btn-rust"
          >
            {borrando ? 'Borrando…' : 'Borrar para siempre'}
          </button>
        </footer>
      </div>
    </>
  )
}
