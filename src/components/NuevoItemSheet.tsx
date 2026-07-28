import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { deleteItem } from '../lib/repo'
import { loadTemasFromCache } from '../lib/db'
import { emitLocalChange, subscribeSyncSettled } from '../lib/sync'
import { useSyncStatus } from '../lib/useSyncStatus'
import { useAiEnabled } from '../lib/useAiEnabled'
import { aplicarAccionCrear, borradorDeAccionCrear, type BorradorItem } from '../lib/accionesPropuestas'
import { extraerDeFoto, prepararFoto, type FotoPreparada } from '../lib/fotoItem'
import { ProposedActionCard, type EstadoAccion } from './ProposedActionCard'
import type { AccionCrear, AssistantUsage, PhotoExtractResponse } from '../types/assistant'
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

type Vista = 'menu' | 'form' | 'foto'

// Tope de correcciones por foto (mejora B, D6-bis): cada corrección gasta un
// mensaje de la misma cuota diaria de IA que el chat (RPD=20 real, ver
// PLAN_ORGANIZADOR.md), así que "sin tope" podía comerse buena parte del día
// en una sola foto difícil. 3 alcanza para lo normal (falta un dato, quedó
// corrida una columna, el tema no es ese) sin dejar que una foto mal sacada
// vacíe la cuota — si hace falta más, conviene sacarla de nuevo.
const MAX_CORRECCIONES = 3

interface NuevoItemSheetProps {
  open: boolean
  vista: Vista
  editingItem: Item | null
  /** Propuesta del ASISTENTE abierta con "Editar antes de confirmar" (viene del
   *  shell, no de este sheet). Se usa igual que el borrador interno de la foto:
   *  precarga el `ItemForm`. Con `editingItem` es una edición; sin él, una
   *  creación. */
  borradorExterno?: BorradorItem | null
  /** El item que se acaba de guardar. Sólo lo escucha quien abrió el sheet con
   *  un borrador externo (el asistente, para saber con qué datos terminó). */
  onGuardado?: (item: Item) => void
  /** Cambia para forzar un `ItemForm` limpio (tras cancelar/guardar, o al
   *  cambiar de ítem a editar). */
  formKey: number
  onElegirEscribir: () => void
  onElegirFoto: () => void
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

// Fases del modo foto. Es una máquina de estados chica y explícita a propósito:
// el paso de "analizando" a "propuesta" es el punto donde la app promete que
// nada se guardó todavía, y con banderas sueltas ese punto se difumina.
//
//   elegir      → esperando que se saque/elija la foto
//   listo       → la foto está elegida y todavía no se mandó: es la ventana para
//                 escribirle un comentario antes de analizarla
//   analizando  → la foto está en camino a Gemini
//   propuesta   → llegó la lectura, se muestra el preview para confirmar
//   corrigiendo → se mandó una corrección sobre esa misma propuesta
//   editando    → el usuario quiso corregirla a mano antes de guardar (ItemForm)
type FaseFoto = 'elegir' | 'listo' | 'analizando' | 'propuesta' | 'corrigiendo' | 'editando'

export function NuevoItemSheet({
  open,
  vista,
  editingItem,
  borradorExterno = null,
  onGuardado,
  formKey,
  onElegirEscribir,
  onElegirFoto,
  onPedirIA,
  onCerrarSuave,
  onResuelto,
}: NuevoItemSheetProps) {
  const { user } = useAuth()
  const { online } = useSyncStatus()
  const aiEnabled = useAiEnabled()
  const [temas, setTemas] = useState<Tema[]>([])
  const [eliminando, setEliminando] = useState(false)
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null)

  // --- Modo foto (ítem 14) -------------------------------------------------
  const fileRef = useRef<HTMLInputElement>(null)
  const [fase, setFase] = useState<FaseFoto>('elegir')
  const [miniatura, setMiniatura] = useState<string | null>(null)
  const [propuesta, setPropuesta] = useState<AccionCrear | null>(null)
  const [resumen, setResumen] = useState<string | null>(null)
  const [estadoAccion, setEstadoAccion] = useState<EstadoAccion>('idle')
  const [errorFoto, setErrorFoto] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<BorradorItem | null>(null)
  const [usoIA, setUsoIA] = useState<AssistantUsage | null>(null)

  // La foto YA achicada se conserva mientras el sheet siga abierto, porque cada
  // corrección la vuelve a mandar. Sigue sin persistirse en ningún lado: vive en
  // este estado, no toca IndexedDB ni el outbox, y se va con el reset de abajo.
  // Es lo que permite corregir sin pedirle al usuario que saque la foto de nuevo.
  const [foto, setFoto] = useState<FotoPreparada | null>(null)
  // Comentario opcional escrito ANTES de analizar. Se sigue mandando en las
  // correcciones: "es un recibo, ignorá el total" tiene que seguir valiendo en
  // la segunda vuelta.
  const [comentario, setComentario] = useState('')
  const [correccionTexto, setCorreccionTexto] = useState('')
  const [mostrarCorreccion, setMostrarCorreccion] = useState(false)
  // Cuántas correcciones se pidieron para esta foto. No hay tope —corregir dos
  // veces es normal—, pero cada una gasta un mensaje de la cuota, así que el
  // número se muestra en vez de dejar que se acumule invisible.
  const [correcciones, setCorrecciones] = useState(0)

  // Reset del modo foto cuando el sheet se resuelve (guardar/cancelar) o cambia
  // de ítem: `formKey` es la misma señal que ya usa el `ItemForm` para volver a
  // arrancar limpio, así que la foto se cuelga de ella en vez de inventar otra.
  useEffect(() => {
    setFase('elegir')
    setMiniatura(null)
    setPropuesta(null)
    setResumen(null)
    setEstadoAccion('idle')
    setErrorFoto(null)
    setBorrador(null)
    setFoto(null)
    setComentario('')
    setCorreccionTexto('')
    setMostrarCorreccion(false)
    setCorrecciones(0)
    if (fileRef.current) fileRef.current.value = ''
  }, [formKey])

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

  // El tema ya se borró (y sus items ya quedaron sin tema) cuando llega acá.
  // Sale de la lista local del selector y se avisa a las páginas de abajo, que
  // tienen que reagrupar: los items que eran de este tema ahora van a "Sin
  // tema".
  function handleTemaDeleted(temaId: string) {
    setTemas((prev) => prev.filter((t) => t.id !== temaId))
    emitLocalChange()
  }

  function handleSaved(item: Item) {
    emitLocalChange()
    // Antes de resolver: `onResuelto` limpia el sheet en el shell (incluido el
    // borrador externo), así que quien lo abrió tiene que enterarse primero.
    onGuardado?.(item)
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

  // --- Modo foto: handlers -------------------------------------------------

  // La foto elegida (o recién sacada). Se achica en memoria y se muestra, pero
  // NO se manda todavía: entre elegirla y analizarla está la ventana para
  // escribirle un comentario ("es un recibo, ignorá el total"). El `File`
  // original queda libre acá mismo; lo que sigue vivo es la versión achicada.
  async function handleFoto(file: File | undefined) {
    if (!file) return

    setErrorFoto(null)
    setPropuesta(null)
    setResumen(null)
    setEstadoAccion('idle')
    setCorreccionTexto('')
    setMostrarCorreccion(false)
    setCorrecciones(0)
    // Se sueltan antes de preparar la nueva: si esta falla, no queremos que
    // quede en pantalla la miniatura de la foto anterior.
    setFoto(null)
    setMiniatura(null)

    try {
      const preparada = await prepararFoto(file)
      setFoto(preparada)
      setMiniatura(preparada.dataUrl)
      setFase('listo')
    } catch {
      setErrorFoto('No se pudo abrir esa imagen. Probá con otra foto.')
      setFase('elegir')
    } finally {
      // El input se limpia siempre: sin esto, volver a elegir el MISMO archivo
      // no dispara `change` y la reintentada no haría nada.
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Vuelta común de las dos llamadas (lectura inicial y corrección). Si no vino
  // propuesta, el motivo ya viene explicado en español desde el server (imagen
  // ilegible, cuota agotada, rate limit) y se vuelve a la fase que se le pasa —
  // que no es la misma en los dos casos: fallar una corrección tiene que dejar
  // en pantalla la propuesta anterior, no mandarte al principio.
  function aplicarRespuesta(data: PhotoExtractResponse, faseSiFalla: FaseFoto): boolean {
    if (data.usage) setUsoIA(data.usage)

    if (!data.accion_propuesta) {
      setErrorFoto(data.respuesta_texto)
      setFase(faseSiFalla)
      return false
    }

    setPropuesta(data.accion_propuesta)
    setResumen(data.respuesta_texto)
    setFase('propuesta')
    return true
  }

  // Analizar: acá recién sale la foto para Gemini, con el comentario si lo hay.
  async function analizarFoto() {
    if (!foto) return

    // Red de seguridad: el botón ya está deshabilitado sin conexión, pero si la
    // señal se cae entre que se eligió la imagen y se toca analizar, cortamos
    // acá en vez de mandar la llamada y mostrar un error de red.
    if (!navigator.onLine) {
      setErrorFoto('No hay conexión — leer una foto no está disponible ahora mismo.')
      return
    }

    setErrorFoto(null)
    setFase('analizando')
    try {
      const data = await extraerDeFoto(foto, temas, {
        comentario: comentario.trim() || undefined,
      })
      aplicarRespuesta(data, 'listo')
    } catch (err) {
      setErrorFoto(err instanceof Error ? err.message : 'No se pudo leer la foto. Intentá de nuevo.')
      setFase('listo')
    }
  }

  // Corrección: se reenvía la MISMA foto que ya está en memoria + la propuesta
  // que el usuario está viendo + lo que dice que está mal, para que Gemini
  // ajuste esa propuesta en vez de empezar de cero. Se puede repetir: la
  // propuesta corregida vuelve a la misma tarjeta y se puede volver a corregir.
  async function enviarCorreccion() {
    const texto = correccionTexto.trim()
    if (!foto || !propuesta || !texto) return

    if (!navigator.onLine) {
      setErrorFoto('No hay conexión — corregir la lectura necesita internet.')
      return
    }

    setErrorFoto(null)
    setFase('corrigiendo')
    try {
      const data = await extraerDeFoto(foto, temas, {
        // El comentario original sigue valiendo en las correcciones: si dijo
        // "ignorá el total", no tiene que volver a decirlo en cada vuelta.
        comentario: comentario.trim() || undefined,
        correccion: { anterior: propuesta, texto },
      })
      if (aplicarRespuesta(data, 'propuesta')) {
        setCorrecciones((n) => n + 1)
        setCorreccionTexto('')
        setMostrarCorreccion(false)
      }
    } catch (err) {
      setErrorFoto(err instanceof Error ? err.message : 'No se pudo aplicar la corrección. Intentá de nuevo.')
      setFase('propuesta')
    }
  }

  // Confirmar: recién acá se escribe algo. Pasa por `repo.ts` como todo el resto,
  // así que es offline-first — si la conexión se cortó entre la lectura y el
  // confirmar, el item se guarda local y sube después.
  async function confirmarPropuesta() {
    if (!propuesta || !user) return
    setEstadoAccion('applying')
    try {
      await aplicarAccionCrear(propuesta, user.id, temas, 'foto', handleTemaCreated)
      setEstadoAccion('done')
      emitLocalChange()
      onResuelto()
    } catch (err) {
      setErrorFoto(err instanceof Error ? err.message : 'No se pudo guardar el item.')
      setEstadoAccion('error')
    }
  }

  // Editar antes de guardar: la propuesta se abre en el `ItemForm` de siempre
  // como una creación con los campos ya cargados. Sigue sin haberse guardado
  // nada — cancelar desde el form no deja rastro.
  function editarPropuesta() {
    if (!propuesta) return
    setBorrador(borradorDeAccionCrear(propuesta, 'foto'))
    setFase('editando')
  }

  // Descartar la lectura y volver a la pantalla de elegir foto, sin cerrar el
  // sheet: lo más probable después de un "no, esto no es lo que quería" es sacar
  // otra foto, no empezar todo de nuevo.
  function descartarPropuesta() {
    setPropuesta(null)
    setResumen(null)
    setMiniatura(null)
    setFoto(null)
    setComentario('')
    setCorreccionTexto('')
    setMostrarCorreccion(false)
    setCorrecciones(0)
    setEstadoAccion('idle')
    setErrorFoto(null)
    setFase('elegir')
  }

  // Una propuesta del asistente abierta acá no es "un ítem nuevo" ni "editar un
  // ítem": es una propuesta a revisar, y el título lo dice — es lo único que
  // recuerda, ya dentro del form, que esto salió de la IA.
  const titulo = borradorExterno
    ? 'Revisar antes de guardar'
    : editingItem
      ? 'Editar ítem'
      : vista === 'foto'
        ? fase === 'editando'
          ? 'Revisar antes de guardar'
          : 'Desde una foto'
        : 'Nuevo ítem'

  // La foto necesita red sí o sí (la lectura la hace Gemini) y la IA activada.
  // Mismo criterio que el asistente: se dice POR QUÉ no se puede, en vez de
  // esconder la opción o dejarla muerta sin explicación.
  const fotoDeshabilitada = !online || aiEnabled === false
  const motivoFotoOff = !online
    ? 'No hay conexión — leer una foto no está disponible ahora mismo.'
    : 'Activá la IA en Ajustes para leer items desde una foto'

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

              {/* La captura por foto (ítem 14). Sigue el mismo criterio de
                  siempre cuando no se puede usar: se muestra el lugar de la
                  función y se dice POR QUÉ está apagada —sin red o sin IA—, en
                  vez de esconderla o dejarla muerta sin explicación. */}
              <button
                type="button"
                className={`sheet-opcion${fotoDeshabilitada ? ' sheet-opcion--off' : ''}`}
                onClick={onElegirFoto}
                disabled={fotoDeshabilitada}
                title={fotoDeshabilitada ? motivoFotoOff : undefined}
              >
                <span className="sheet-opcion__icon">
                  <IconoFoto />
                </span>
                <span className="sheet-opcion__texto">
                  <span className="sheet-opcion__label">Desde una foto</span>
                  <span className="sheet-opcion__desc">
                    {fotoDeshabilitada
                      ? motivoFotoOff
                      : 'Sacale una foto y te propone el ítem para revisar.'}
                  </span>
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
          ) : vista === 'foto' && fase !== 'editando' ? (
            <div className="foto-modo">
              {/* El input real no se ve nunca: lo dispara el botón de abajo.
                  `capture="environment"` hace que en el teléfono se abra
                  directo la cámara trasera; en desktop el atributo se ignora y
                  queda el selector de archivos de siempre. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => handleFoto(e.target.files?.[0])}
              />

              {miniatura && (
                <div className="foto-miniatura">
                  <img src={miniatura} alt="La foto que se está leyendo" />
                </div>
              )}

              {fase === 'elegir' && (
                <>
                  <p className="foto-ayuda">
                    Sacale una foto a una lista escrita a mano, un recibo, una tabla o un cartel.
                    Te propone un ítem y lo revisás antes de guardar.
                  </p>
                  {errorFoto && <p className="text-sm text-rust">{errorFoto}</p>}
                  <button
                    type="button"
                    className="btn-moss"
                    onClick={() => fileRef.current?.click()}
                    disabled={fotoDeshabilitada}
                  >
                    Sacar o elegir una foto
                  </button>
                  {/* La foto no se guarda: se dice acá, donde se está por
                      sacarla, y no en un texto legal en otro lado. */}
                  <p className="foto-nota">
                    La imagen se usa sólo para leerla y se descarta — no se guarda en tu cuenta.
                  </p>
                </>
              )}

              {/* La foto ya está elegida pero todavía no salió. Es la ventana
                  para decirle a Gemini algo que la imagen sola no dice: qué es,
                  o qué NO mirar. Opcional a propósito — el flujo de sacar foto y
                  analizar de una tiene que seguir siendo un solo toque más. */}
              {fase === 'listo' && (
                <>
                  <div className="foto-comentario">
                    <label className="label" htmlFor="foto-comentario">
                      Comentario (opcional)
                    </label>
                    <textarea
                      id="foto-comentario"
                      value={comentario}
                      onChange={(e) => setComentario(e.target.value)}
                      rows={2}
                      placeholder="Agregá contexto si querés — ej. “es un recibo, ignorá el total”"
                      className="ctl w-full"
                    />
                    <p className="foto-nota">
                      Sirve para lo que la foto no dice sola: qué es, qué parte te importa o qué
                      ignorar.
                    </p>
                  </div>

                  {errorFoto && <p className="text-sm text-rust">{errorFoto}</p>}

                  <div className="foto-acciones">
                    <button
                      type="button"
                      className="btn-moss"
                      onClick={analizarFoto}
                      disabled={fotoDeshabilitada}
                    >
                      Analizar imagen
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => fileRef.current?.click()}
                      disabled={fotoDeshabilitada}
                    >
                      Probar con otra foto
                    </button>
                  </div>
                </>
              )}

              {fase === 'analizando' && <p className="text-sm text-ink-soft">Leyendo la foto…</p>}

              {fase === 'corrigiendo' && (
                <p className="text-sm text-ink-soft">Aplicando tu corrección…</p>
              )}

              {fase === 'propuesta' && propuesta && (
                <>
                  {resumen && <p className="text-sm text-ink">{resumen}</p>}
                  {errorFoto && <p className="text-sm text-rust">{errorFoto}</p>}
                  {/* Misma tarjeta de preview que el asistente: nada se guarda
                      hasta que se confirma acá. */}
                  <ProposedActionCard
                    accion={propuesta}
                    estado={estadoAccion}
                    errorMsg={errorFoto ?? undefined}
                    items={[]}
                    confirmLabel="Guardar item"
                    onConfirm={confirmarPropuesta}
                    onCancel={descartarPropuesta}
                  />

                  {estadoAccion === 'idle' && !mostrarCorreccion && (
                    <div className="foto-revisar">
                      <button type="button" className="link-underline text-sm" onClick={editarPropuesta}>
                        Editar antes de guardar
                      </button>
                      {/* Corregir ≠ editar. Editar abre el form y lo arregla a
                          mano; corregir se lo devuelve a Gemini con la misma
                          foto — sirve cuando falta algo que está en la imagen y
                          escribirlo a mano sería transcribirlo uno mismo. */}
                      <button
                        type="button"
                        className="link-underline text-sm disabled:opacity-60 disabled:cursor-not-allowed disabled:no-underline"
                        onClick={() => setMostrarCorreccion(true)}
                        disabled={correcciones >= MAX_CORRECCIONES}
                        title={
                          correcciones >= MAX_CORRECCIONES
                            ? `Ya usaste las ${MAX_CORRECCIONES} correcciones de esta foto.`
                            : undefined
                        }
                      >
                        Esto no está bien
                      </button>
                    </div>
                  )}

                  {estadoAccion === 'idle' && !mostrarCorreccion && correcciones >= MAX_CORRECCIONES && (
                    <p className="foto-nota">
                      Ya usaste las {MAX_CORRECCIONES} correcciones de esta foto. Si necesitás ajustar algo
                      más, sacá la foto de nuevo.
                    </p>
                  )}

                  {estadoAccion === 'idle' && mostrarCorreccion && (
                    <div className="foto-correccion">
                      <label className="label" htmlFor="foto-correccion">
                        ¿Qué está mal?
                      </label>
                      <textarea
                        id="foto-correccion"
                        value={correccionTexto}
                        onChange={(e) => setCorreccionTexto(e.target.value)}
                        rows={2}
                        autoFocus
                        placeholder="Ej. “te faltó la última fila” · “el tema no es ese” · “los precios están corridos una columna”"
                        className="ctl w-full"
                      />
                      <div className="foto-acciones">
                        <button
                          type="button"
                          className="btn-moss"
                          onClick={enviarCorreccion}
                          disabled={!correccionTexto.trim()}
                        >
                          Enviar corrección
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => {
                            setMostrarCorreccion(false)
                            setCorreccionTexto('')
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                      {/* Sin cartel de advertencia: se dice el costo una vez, en
                          el lugar donde se decide, y en el mismo tono que el
                          contador de cuota de abajo. */}
                      <p className="foto-nota">
                        Vuelve a mirar la misma foto y ajusta lo que señalás. Usa un mensaje de IA.
                      </p>
                    </div>
                  )}

                  {correcciones > 0 && (
                    <p className="foto-correcciones">
                      {correcciones} de {MAX_CORRECCIONES} correcciones usadas
                    </p>
                  )}
                </>
              )}

              {usoIA?.daily_quota != null && (
                <p className="text-xs text-slate text-right font-mono">
                  {usoIA.used_today ?? 0} de {usoIA.daily_quota} mensajes de IA usados hoy
                </p>
              )}
            </div>
          ) : (
            <>
              <ItemForm
                key={formKey}
                userId={user.id}
                temas={temas}
                editingItem={editingItem}
                // El borrador interno es el de la foto; el externo, el del
                // asistente. Nunca conviven: la foto vive en `vista === 'foto'`
                // y el del asistente abre el sheet directo en el form.
                borrador={borrador ?? borradorExterno}
                onSaved={handleSaved}
                onCancel={onResuelto}
                onTemaCreated={handleTemaCreated}
                onTemaUpdated={handleTemaUpdated}
                onTemaDeleted={handleTemaDeleted}
              />

              {/* Eliminar vive acá, en el modo edición, con la misma confirmación
                  que la ficha de la Biblioteca (task 3). Separado del bloque
                  Guardar/Cancelar del form y en tono destructivo.

                  No se ofrece cuando lo que se está revisando es una propuesta
                  del asistente: ahí la pregunta es "¿guardo esta edición?", y un
                  botón de borrar el item entero al lado sería otra decisión, más
                  grave, que nadie pidió. Para borrarlo está la Biblioteca. */}
              {editingItem && !borradorExterno && (
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
