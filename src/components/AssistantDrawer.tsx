import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useAiEnabled } from '../lib/useAiEnabled'
import { dictadoVozSoportado, useDictadoVoz } from '../lib/useDictadoVoz'
import { supabase } from '../lib/supabase'
// Las acciones que confirma el usuario escriben por el repositorio local (igual
// que el CRUD manual): si la conexión se corta entre proponer y confirmar, el
// cambio no se pierde, queda encolado.
import {
  createTema,
  deleteItem,
  deleteRecordatoriosForItem,
  getRecordatorioForItem,
  updateItem,
  upsertRecordatorio,
} from '../lib/repo'
import {
  aplicarAccionCrear,
  borradorDeAccionCrear,
  borradorDeAccionEditar,
  datosFinalesDeItem,
  lineasConCambios,
  lineasDeItem,
  type BorradorItem,
} from '../lib/accionesPropuestas'
import { loadItemsFromCache, loadTemasFromCache } from '../lib/db'
import { requestSync } from '../lib/sync'
import { useSyncStatus } from '../lib/useSyncStatus'
import { datetimeLocalToIso, isoToDatetimeLocal, proximaFechaConHora } from '../lib/recordatorios'
import { diasUtcALocales, prepararRecurrencia } from '../lib/recurrencia'
import { ProposedActionCard, type EstadoAccion, type PendingAction } from './ProposedActionCard'
import type { Item, ItemInsert, Recordatorio, Tema } from '../types/database'
import type {
  AccionPropuesta,
  AssistantResponse,
  AssistantUsage,
  ChatMessage,
  EstadoAccionHistorial,
} from '../types/assistant'

// Asistente como drawer (PLAN_REDISEÑO.md ítem 10). Antes era la página
// `/assistant`; ahora el MOTOR es el mismo —chat, envío, propuestas,
// confirmar-una/confirmar-todas, cooldown, usage, banner de sin conexión— y lo
// único que cambió es el contenedor: en vez de una ruta que se monta y desmonta
// al navegar, es un panel que vive montado en el shell.
//
//   ≥900px  drawer a la derecha, alto completo, entra desde el borde.
//   <900px  bottom-sheet, entra desde abajo, con esquinas redondeadas arriba.
// Mismo breakpoint (900) que `useIsWide`; acá lo resuelven las media queries de
// index.css, porque el chrome es idéntico y sólo cambia de dónde entra.
//
// PRESERVACIÓN DE ESTADO (tarea 3 del ítem): el chat vive en el `useState` de
// este componente, y AppShell lo mantiene montado una vez abierto — cerrar sólo
// baja una clase de CSS, no desmonta. Por eso reabrir conserva la conversación,
// las propuestas y el cooldown. Antes, al ser una ruta, navegar afuera lo
// desmontaba y se perdía todo.

// `ProposedActionCard` (la tarjeta de preview) y los tipos del estado de cada
// acción viven ahora en su propio archivo: la captura por foto (ítem 14) usa la
// misma tarjeta, y el principio de "la IA nunca escribe sin confirmación" se
// sostiene mejor con un solo preview compartido que con dos copias.

function IconoChispa({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
    >
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10z" />
    </svg>
  )
}

function IconoCerrar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function IconoMic({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  )
}

// El aviso de "sin conexión" del asistente.
//
// Es el contrapeso de la mejora en `useAiEnabled`: el botón que abre el panel
// ahora se dibuja habilitado sin red (refleja el último estado conocido de la
// IA, no un apagón inventado), así que la explicación de por qué el asistente
// no responde tiene que estar acá, arriba de todo y con todas las letras. Un
// banner y no un error de red genérico ni un rebote a Ajustes: el problema no es
// la configuración de la IA, es que no hay internet, y son dos arreglos
// distintos.
//
// Va en las DOS salidas del panel (IA apagada y chat normal), porque sin señal
// el estado de la IA que estamos mostrando es el último conocido y el hecho que
// manda es la falta de red.
function AvisoSinConexion() {
  return (
    <div className="bg-card border border-line border-l-4 border-l-rust rounded-[2px] p-4">
      <p className="text-sm text-ink">
        No hay conexión — el asistente no está disponible ahora mismo.
      </p>
      {/* `text-ink-soft` y no el `text-slate` que traía el banner viejo: medido
          sobre la tarjeta en claro, slate a 12px da 3.6:1 — abajo del 4.5:1 de
          AA. Se lo podía tolerar como meta decorativa; no acá, que es la
          explicación de por qué el asistente no responde. ink-soft mide 7.1:1
          en claro y 7.7:1 en oscuro, y sigue leyéndose como secundario. */}
      <p className="text-xs text-ink-soft mt-1.5">
        Necesita internet para responder. Tus items siguen acá: podés crear, editar y borrar sin
        señal, y se sincroniza solo cuando vuelva.
      </p>
    </div>
  )
}

export function AssistantDrawer({
  open,
  onClose,
  onEditarPropuesta,
}: {
  open: boolean
  onClose: () => void
  /** "Editar antes de confirmar": abre la propuesta en el sheet de ítem, con el
   *  `ItemForm` de siempre ya cargado. Lo provee el shell, que es el que tiene
   *  el sheet — ver `abrirBorradorPropuesto` en AppShell. */
  onEditarPropuesta?: (
    borrador: BorradorItem,
    item: Item | null,
    onGuardado: (guardado: Item) => void,
  ) => void
}) {
  const { user } = useAuth()
  const aiEnabled = useAiEnabled()
  const { online } = useSyncStatus()

  const [items, setItems] = useState<Item[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction[]>([])
  // Espejo síncrono de `pending`. `confirmAll` recorre varias acciones con
  // `await` de por medio sin que el componente vuelva a renderizar entre
  // medio, así que el `pending` capturado en su closure queda pegado al
  // snapshot de cuando arrancó — nunca se entera de lo que las iteraciones
  // anteriores (u otro click del usuario, ej. cancelar una tarjeta mientras
  // el lote corre) le hicieron al array. `pendingRef` sí se actualiza al
  // toque porque `updatePending` lo escribe antes de pedir el re-render, así
  // que es la única fuente confiable de "estado actual" dentro de un loop.
  const pendingRef = useRef<PendingAction[]>([])
  function updatePending(updater: PendingAction[] | ((prev: PendingAction[]) => PendingAction[])) {
    pendingRef.current = typeof updater === 'function' ? updater(pendingRef.current) : updater
    setPending(pendingRef.current)
  }
  // Índice del mensaje del chat dueño de las tarjetas que están en `pending`.
  // Confirmar o cancelar tiene que escribir el desenlace ADENTRO de ese mensaje
  // —no en una burbuja nueva— porque el historial que se reenvía sale de
  // `messages`, y `pending` se limpia en cuanto el usuario escribe otra cosa.
  const [pendingMsgIndex, setPendingMsgIndex] = useState<number | null>(null)
  const [usage, setUsage] = useState<AssistantUsage | null>(null)
  const [cooldown, setCooldown] = useState(0) // segundos restantes de rate limit corto

  const scrollRef = useRef<HTMLDivElement>(null)

  // Dictado de voz: mantener presionado el mic transcribe al mismo input de
  // texto, sumando a lo que ya hubiera escrito — nunca lo reemplaza ni envía
  // solo. `inputAlEmpezarRef` guarda una foto del input al momento de apretar,
  // porque cada evento `onresult` trae el texto reconocido COMPLETO de esta
  // sesión de grabación (no un delta), y hay que pegarlo sobre lo que ya
  // había, no sobre el último valor de `input` (que en el próximo render ya
  // incluye lo dictado).
  const { grabando, errorPermiso, iniciar: iniciarDictado, detener: detenerDictado } = useDictadoVoz()
  const inputAlEmpezarRef = useRef('')

  function iniciarGrabacion() {
    if (!online || sending || cooldown > 0) return
    inputAlEmpezarRef.current = input
    iniciarDictado((texto) => {
      const base = inputAlEmpezarRef.current
      setInput(base && texto ? `${base} ${texto}` : base || texto)
    })
  }

  // Cuenta regresiva del rate limit por minuto: deshabilita el input hasta 0.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  async function loadData() {
    if (!user) return
    // Leemos del espejo local (instantáneo) y pedimos un sync para que se ponga
    // al día contra el servidor en segundo plano.
    try {
      const [ci, ct] = await Promise.all([loadItemsFromCache(), loadTemasFromCache()])
      setItems(ci)
      setTemas(ct)
    } catch {
      /* lectura local best-effort */
    }
    requestSync()
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, pending])

  // Escape cierra el panel, como se espera de cualquier diálogo modal. Sólo
  // mientras está abierto, para no comerse la tecla en el resto de la app.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return

    // Red de seguridad: el input ya está deshabilitado sin conexión, pero si la
    // señal se cae entre que se escribió y se envió, cortamos acá en vez de
    // mandar la llamada y mostrar un error de red genérico.
    if (!navigator.onLine) {
      setError('No hay conexión — el asistente no está disponible ahora mismo.')
      return
    }

    const userMsg: ChatMessage = { role: 'user', text }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setSending(true)
    setError(null)
    updatePending([])

    const { data, error } = await supabase.functions.invoke<AssistantResponse>('ai-assistant', {
      body: {
        // Además del texto va la estructura de cada acción propuesta y cómo
        // terminó, para que el backend pueda reconstruir el turno como el par
        // functionCall/functionResponse que realmente fue. Sin esto, confirmar o
        // cancelar no dejaba rastro y el modelo podía re-proponer algo ya hecho
        // o ya rechazado.
        messages: history.map((m) => ({
          role: m.role,
          text: m.text,
          solo_ui: m.solo_ui,
          acciones: m.acciones?.map((a) => ({
            tool: a.call?.tool,
            args: a.call?.args,
            estado: a.estado,
            item_id: a.item_id,
            error: a.error,
            // Si el usuario la ajustó en el form antes de guardar, el modelo
            // tiene que enterarse de que lo aplicado NO son sus `args`.
            ajustada: a.ajustada,
            datos_finales: a.datos_finales,
          })),
        })),
        // Hora local del usuario para que Gemini resuelva "mañana a las 9", etc.
        client_now: isoToDatetimeLocal(new Date().toISOString()),
      },
    })

    setSending(false)

    if (error || !data) {
      // supabase-js descarta el body en error.message y solo deja "non-2xx
      // status code". Leemos error.context (la Response cruda) para tomar el
      // { error } de la función, que ya viene traducido al español desde el
      // server. No parseamos JSON de Gemini acá: eso lo hace la Edge Function.
      let real = 'No se pudo contactar al asistente. Intentá de nuevo.'
      const ctx = (error as { context?: Response } | undefined)?.context
      if (ctx && typeof ctx.clone === 'function') {
        try {
          const body = await ctx.clone().json()
          if (typeof body?.error === 'string') real = body.error
        } catch {
          /* sin body JSON legible: dejamos el mensaje genérico en español */
        }
      }
      console.error('[ai-assistant] error real:', real, error)
      setError(real)
      return
    }

    const acciones = data.acciones_propuestas ?? []
    const calls = data.calls_propuestas ?? []
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      text: data.respuesta_texto,
      // Arrancan en 'sin_responder' a propósito: si el usuario no toca las
      // tarjetas y sigue escribiendo, ése es exactamente el desenlace que hay
      // que informarle al modelo. Confirmar o cancelar lo pisa después.
      acciones: acciones.length
        ? acciones.map((accion, i) => ({
            accion,
            call: calls[i],
            estado: 'sin_responder' as EstadoAccionHistorial,
          }))
        : undefined,
    }
    // El mensaje del asistente se agrega al final de `history`, así que su
    // índice es el largo de `history` (que ya incluye el mensaje del usuario).
    setPendingMsgIndex(history.length)
    setMessages((prev) => [...prev, assistantMsg])
    updatePending(acciones.map((accion) => ({ accion, estado: 'idle' as EstadoAccion })))
    if (data.usage) setUsage(data.usage)

    // Rate limit por minuto: arrancamos la cuenta regresiva que bloquea el input.
    if (data.rate_limit?.kind === 'short' && data.rate_limit.retry_after_seconds) {
      setCooldown(data.rate_limit.retry_after_seconds)
    }
  }

  // Resuelve el nombre de tema que propuso la IA a un id, creándolo si no
  // existe. El tema creado por la IA sale con color automático igual que el
  // manual: el default vive en repo.createTema, no en el form (Fase 2, D4).
  //
  // El chequeo contra `temas` de acá abajo es sólo un atajo (evita el viaje a
  // IndexedDB en el caso común): `temas` es el estado de React de este
  // render, y en un lote de varias acciones seguidas (`confirmAll`) puede
  // haberse quedado atrás de lo que las acciones anteriores del mismo lote
  // ya crearon. La protección real —que dos acciones del mismo lote no creen
  // el mismo tema dos veces— vive en `repo.createTema`, que dedupea contra el
  // espejo local justo antes de insertar.
  async function resolveTemaId(nombre: string | null | undefined): Promise<string | null> {
    if (!nombre) return null
    const existing = temas.find((t) => t.nombre.toLowerCase() === nombre.toLowerCase())
    if (existing) return existing.id
    const tema = await createTema(user!.id, nombre)
    sumarTema(tema)
    return tema.id
  }

  function sumarTema(tema: Tema) {
    setTemas((prev) => [...prev, tema].sort((a, b) => a.nombre.localeCompare(b.nombre)))
  }

  // Aplica una acción propuesta contra Supabase (reusa el mismo CRUD manual, así
  // que respeta RLS). Soporta listas (líneas) y recordatorios.
  //
  // Devuelve el item creado en el caso `create` —el único donde el id no se sabía
  // de antes— para poder informárselo al modelo en el historial.
  async function applyAction(accion: AccionPropuesta): Promise<Item | undefined> {
    if (accion.tipo_accion === 'create') {
      // El "cómo se guarda un create propuesto" es compartido con la captura por
      // foto: vive en lib/accionesPropuestas.ts. `origen: 'texto'` es lo que
      // distingue en la base este camino del de la foto.
      return await aplicarAccionCrear(accion, user!.id, temas, 'texto', sumarTema)
    }

    if (accion.tipo_accion === 'update') {
      const c = accion.cambios
      const current = items.find((it) => it.id === accion.item_id)
      const patch: Partial<ItemInsert> = {}
      if (c.tipo) patch.tipo = c.tipo
      if (c.prioridad !== undefined) patch.prioridad = c.prioridad
      if ('tema' in c) patch.tema_id = await resolveTemaId(c.tema)
      if (c.contenido) patch.contenido = { texto: c.contenido }

      // Edición de líneas de lista: partimos del contenido actual del item. El
      // cálculo vive en `lib/accionesPropuestas` porque "editar antes de
      // confirmar" tiene que precargar el form con EXACTAMENTE lo mismo que se
      // guardaría acá; con dos copias, revisar la propuesta habría podido
      // mostrar una lista distinta de la que se iba a escribir.
      const editaLineas =
        c.lineas_agregar || c.lineas_quitar || c.lineas_marcar_hechas || c.lineas_desmarcar
      if (editaLineas) {
        patch.contenido = { items: lineasConCambios(lineasDeItem(current), c) }
      }

      if (Object.keys(patch).length > 0) {
        await updateItem(accion.item_id, patch)
      }

      if (c.quitar_recordatorio) {
        await deleteRecordatoriosForItem(accion.item_id)
      } else if (
        c.recordatorio_fecha_hora ||
        c.recordatorio_hora ||
        c.recordatorio_recurrencia !== undefined
      ) {
        // `upsertRecordatorio` pisa fecha Y recurrencia de una, así que hay que
        // completar el campo que esta acción NO trae con el valor actual. Si no,
        // "movelo a las 10" borraría el "todos los días" de un recordatorio que
        // ya se repetía, y "hacelo semanal" necesitaría una fecha que nadie
        // mandó.
        const existente = await getRecordatorioForItem(accion.item_id)
        // Al pasar a "diario"/"días específicos" el asistente manda hora sola:
        // la fecha de arranque se recalcula acá igual que en el form manual, en
        // vez de conservar la del recordatorio anterior (que podría ser de un
        // día que ya no corresponde).
        const fechaLocal =
          c.recordatorio_hora && !c.recordatorio_fecha_hora
            ? proximaFechaConHora(c.recordatorio_hora)
            : (c.recordatorio_fecha_hora ?? null)
        const fecha = fechaLocal ? datetimeLocalToIso(fechaLocal) : existente?.fecha_hora

        // Sin fecha (ni nueva ni previa) no hay recordatorio que crear: cambiar
        // la recurrencia de algo que no existe no es una acción sensata.
        if (fecha) {
          const recurrencia =
            c.recordatorio_recurrencia !== undefined
              ? c.recordatorio_recurrencia // valor nuevo, o null para apagarla
              : (existente?.recurrencia ?? null)

          // Los días siguen la misma regla que la recurrencia: si la acción trae
          // unos nuevos se usan (vienen en escala local, como la fecha), y si no,
          // se conservan los que ya estaban — pero ésos ya están guardados en
          // UTC, así que hay que devolverlos a la escala local antes de que
          // `prepararRecurrencia` los vuelva a convertir. Sin ese ida y vuelta,
          // mover la hora de un "lunes y miércoles" le correría los días.
          const diasLocales =
            c.recordatorio_dias ??
            (existente?.recurrencia_dias
              ? diasUtcALocales(existente.recurrencia_dias, new Date(existente.fecha_hora))
              : null)

          const listo = prepararRecurrencia(fecha, recurrencia, diasLocales)
          await upsertRecordatorio(
            accion.item_id,
            listo.fechaIso,
            listo.recurrencia,
            listo.diasUtc,
          )
        }
      }
      return
    }

    // delete
    await deleteItem(accion.item_id)
  }

  function notaOk(accion: AccionPropuesta): string {
    switch (accion.tipo_accion) {
      case 'create':
        return 'Listo, creé el item.'
      case 'update':
        return 'Listo, actualicé el item.'
      case 'delete':
        return 'Listo, borré el item.'
    }
  }

  // Igual que `notaOk` pero del otro lado: sin esto, cancelar no dejaba ninguna
  // huella en el chat, y como las tarjetas se limpian al enviar el mensaje
  // siguiente, el rechazo desaparecía de la vista por completo.
  function notaCancelada(accion: AccionPropuesta): string {
    switch (accion.tipo_accion) {
      case 'create':
        return 'Cancelaste la creación: no se creó nada.'
      case 'update':
        return 'Cancelaste la edición: el item quedó como estaba.'
      case 'delete':
        return 'Cancelaste el borrado: el item sigue ahí.'
    }
  }

  // Graba el desenlace de una acción dentro del mensaje que la propuso. Es el
  // único lugar donde el historial se entera de que algo se confirmó, se canceló
  // o falló: la tarjeta de `pending` desaparece en cuanto el usuario escribe de
  // nuevo, `messages` es lo que persiste y lo que se reenvía.
  function marcarAccion(
    index: number,
    estado: EstadoAccionHistorial,
    extra?: {
      item_id?: string
      error?: string
      ajustada?: boolean
      datos_finales?: Record<string, unknown>
    },
  ) {
    setMessages((prev) =>
      prev.map((m, mi) =>
        mi !== pendingMsgIndex || !m.acciones
          ? m
          : {
              ...m,
              acciones: m.acciones.map((a, ai) => (ai === index ? { ...a, estado, ...extra } : a)),
            },
      ),
    )
  }

  // Aplica UNA acción (por índice) y actualiza su estado en la tarjeta.
  async function confirmOne(index: number): Promise<boolean> {
    const target = pendingRef.current[index]
    if (!target || target.estado !== 'idle') return false

    updatePending((prev) => prev.map((p, i) => (i === index ? { ...p, estado: 'applying' } : p)))
    setError(null)
    try {
      const creado = await applyAction(target.accion)
      updatePending((prev) => prev.map((p, i) => (i === index ? { ...p, estado: 'done' } : p)))
      // El id real del item: en un create sale recién de aplicarlo, y es lo que
      // le permite al modelo referirse después a lo que acaba de crear sin
      // tener que volver a listar.
      const itemId =
        target.accion.tipo_accion === 'create' ? creado?.id : target.accion.item_id
      marcarAccion(index, 'aplicada', { item_id: itemId })
      // La burbuja de confirmación es sólo para el usuario (`solo_ui`): en el
      // historial, lo que pasó ya lo dice el functionResponse, y con más detalle.
      setMessages((prev) => [...prev, { role: 'assistant', text: notaOk(target.accion), solo_ui: true }])
      await loadData()
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo aplicar el cambio.'
      updatePending((prev) => prev.map((p, i) => (i === index ? { ...p, estado: 'error', error: msg } : p)))
      marcarAccion(index, 'error', { error: msg })
      return false
    }
  }

  // "Editar antes de confirmar": la propuesta se abre en el `ItemForm` de
  // siempre, ya cargada, y el usuario ajusta lo que quiera antes de guardar.
  //
  // Lo que se guarda desde ahí NO pasa por `applyAction`: el form escribe
  // directo con `createItem`/`updateItem`, igual que cualquier item hecho a
  // mano. Es a propósito — "confirmar la propuesta tal cual" y "guardé esto que
  // revisé y corregí" son dos cosas distintas, y la segunda ya no necesita que
  // nadie interprete los args del modelo.
  async function editOne(index: number) {
    const target = pendingRef.current[index]
    if (!target || target.estado !== 'idle' || !onEditarPropuesta) return
    const accion = target.accion
    if (accion.tipo_accion === 'delete') return // un borrado no se edita: es sí o no

    setError(null)

    if (accion.tipo_accion === 'create') {
      onEditarPropuesta(borradorDeAccionCrear(accion, 'texto'), null, (guardado) => {
        void resolverConAjustes(index, guardado)
      })
      return
    }

    // Update: el borrador es el item REAL con los cambios propuestos encima, y
    // el form abre en modo edición sobre ese mismo item.
    const item = items.find((it) => it.id === accion.item_id)
    if (!item) {
      // Sin el item no se puede abrir una edición: abrir el form igual lo
      // trataría como creación y duplicaría lo que se quería cambiar.
      setError('No encuentro ese item para editarlo. Probá confirmar la propuesta o pedile al asistente que lo busque de nuevo.')
      return
    }
    const temaNombre = item.tema_id ? (temas.find((t) => t.id === item.tema_id)?.nombre ?? null) : null
    // El recordatorio actual hace falta para completar lo que los cambios NO
    // traen: "movelo a las 10" no puede perder el "todos los días" que ya tenía.
    const existente = await getRecordatorioForItem(item.id).catch(() => null)

    onEditarPropuesta(
      borradorDeAccionEditar(accion, item, temaNombre, existente),
      item,
      (guardado) => {
        void resolverConAjustes(index, guardado)
      },
    )
  }

  // El form guardó: la tarjeta queda aplicada y el historial se entera de que lo
  // que existe son los datos FINALES, no los que propuso el modelo (sin esto,
  // en el turno siguiente hablaría de un item que no es el que hay).
  async function resolverConAjustes(index: number, guardado: Item) {
    updatePending((prev) =>
      prev.map((p, i) => (i === index ? { ...p, estado: 'done', ajustada: true } : p)),
    )

    // Se releen del espejo local en vez de adivinarse: el tema puede haberse
    // creado recién dentro del form, y el recordatorio se guarda aparte del item.
    let temaNombre: string | null = null
    let recordatorio: Recordatorio | null = null
    try {
      const [temasFrescos, rec] = await Promise.all([
        loadTemasFromCache(),
        getRecordatorioForItem(guardado.id),
      ])
      temaNombre = guardado.tema_id
        ? (temasFrescos.find((t) => t.id === guardado.tema_id)?.nombre ?? null)
        : null
      recordatorio = rec
    } catch {
      /* lectura local best-effort: sin esto el desenlace igual se informa */
    }

    marcarAccion(index, 'aplicada', {
      item_id: guardado.id,
      ajustada: true,
      datos_finales: datosFinalesDeItem(guardado, temaNombre, recordatorio),
    })
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', text: 'Listo, lo guardé con tus ajustes.', solo_ui: true },
    ])
    await loadData()
  }

  // Cancelar también deja rastro (bug C-1: antes no agregaba NADA, ni al chat ni
  // al historial, así que el modelo podía volver a proponer lo mismo que el
  // usuario acababa de rechazar).
  function cancelOne(index: number) {
    const target = pendingRef.current[index]
    if (!target || target.estado !== 'idle') return
    updatePending((prev) => prev.map((p, i) => (i === index ? { ...p, estado: 'cancelled' } : p)))
    marcarAccion(index, 'cancelada')
    setMessages((prev) => [...prev, { role: 'assistant', text: notaCancelada(target.accion), solo_ui: true }])
  }

  async function confirmAll() {
    // Aplica secuencialmente todas las que sigan pendientes (idle). Lee
    // `pendingRef.current` en cada vuelta —no `pending`— porque el loop cruza
    // varios `await` y mientras tanto el usuario puede cancelar una tarjeta
    // todavía no procesada, o una iteración anterior puede haber creado un
    // tema que ésta necesita reusar.
    for (let i = 0; i < pendingRef.current.length; i++) {
      if (pendingRef.current[i]?.estado === 'idle') {
        await confirmOne(i)
      }
    }
  }

  const anyApplying = pending.some((p) => p.estado === 'applying')
  const idleCount = pending.filter((p) => p.estado === 'idle').length

  // El cuerpo del panel: la IA apagada muestra el rebote a Ajustes; encendida,
  // el chat. El chrome (overlay + panel + cabecera) es el mismo en los dos
  // casos, así que el "no está activada" también se ve dentro del drawer y no
  // como página suelta.
  let cuerpo: ReactNode
  if (!user) {
    cuerpo = null
  } else if (aiEnabled === false) {
    cuerpo = (
      <div className="asistente-chat">
        {!online && <AvisoSinConexion />}
        <div className="bg-card border border-line rounded-[4px] p-6 text-center">
          <p className="text-sm text-ink-soft mb-3">La IA no está activada.</p>
          <Link to="/settings" onClick={onClose} className="link-underline text-sm">
            Activá la IA en Ajustes para usar el asistente
          </Link>
        </div>
      </div>
    )
  } else {
    cuerpo = (
      <div className="asistente-chat">
        {!online && <AvisoSinConexion />}

        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 min-h-[120px]">
          {messages.length === 0 && (
            <p className="text-sm text-ink-soft">
              Preguntale al asistente por tus items, o pedile que cree/edite/borre uno. Cualquier
              cambio te lo va a mostrar para confirmar antes de aplicarlo.
            </p>
          )}

          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <span
                className={`inline-block rounded-[2px] px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-moss text-moss-ink'
                    : 'bg-card border border-line text-ink'
                }`}
              >
                {m.text}
              </span>
            </div>
          ))}

          {sending && <p className="text-sm text-ink-soft">Pensando…</p>}

          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.length > 1 && idleCount > 0 && (
                <div className="flex items-center gap-3">
                  <button onClick={confirmAll} disabled={anyApplying} className="btn-moss">
                    {anyApplying ? 'Aplicando…' : `Confirmar todas (${idleCount})`}
                  </button>
                  <span className="text-xs text-slate font-mono">
                    o confirmá/cancelá una por una abajo
                  </span>
                </div>
              )}

              {pending.map((p, i) => (
                <ProposedActionCard
                  key={i}
                  accion={p.accion}
                  estado={p.estado}
                  errorMsg={p.error}
                  ajustada={p.ajustada}
                  items={items}
                  onConfirm={() => confirmOne(i)}
                  onCancel={() => cancelOne(i)}
                  // Sin el puente del shell no hay dónde abrir el form: la
                  // tarjeta se queda con Confirmar/Cancelar y nada se rompe.
                  onEdit={onEditarPropuesta ? () => void editOne(i) : undefined}
                />
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-rust">{error}</p>}

        {errorPermiso && <p className="text-sm text-rust">{errorPermiso}</p>}

        {cooldown > 0 && (
          <p className="text-sm text-gold">
            Esperá {cooldown} segundo{cooldown === 1 ? '' : 's'} antes de enviar otro mensaje.
          </p>
        )}

        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              !online
                ? 'Sin conexión — el asistente no está disponible'
                : cooldown > 0
                  ? `Esperá ${cooldown}s…`
                  : 'Escribí un mensaje…'
            }
            disabled={!online || sending || cooldown > 0}
            className="ctl flex-1 disabled:opacity-60"
          />
          {dictadoVozSoportado && (
            <button
              type="button"
              onMouseDown={iniciarGrabacion}
              onMouseUp={detenerDictado}
              onMouseLeave={detenerDictado}
              onTouchStart={iniciarGrabacion}
              onTouchEnd={detenerDictado}
              onTouchCancel={detenerDictado}
              onContextMenu={(e) => e.preventDefault()}
              disabled={!online || sending || cooldown > 0}
              aria-label={grabando ? 'Grabando… soltá para terminar' : 'Mantené presionado para dictar'}
              title="Mantené presionado para dictar"
              className={`mic-btn${grabando ? ' mic-btn--recording' : ''}`}
            >
              <IconoMic />
            </button>
          )}
          <button
            type="submit"
            disabled={!online || sending || cooldown > 0 || !input.trim()}
            className="btn-moss"
          >
            Enviar
          </button>
        </form>

        {usage?.daily_quota != null && (
          <p className="text-xs text-slate text-right font-mono">
            {usage.used_today ?? 0} de {usage.daily_quota} mensajes de IA usados hoy
          </p>
        )}
      </div>
    )
  }

  return (
    <>
      {/* El telón: click afuera cierra. Se desvanece con el panel y, cerrado,
          queda fuera del árbol accesible. */}
      <div
        className={`drawer-overlay${open ? ' drawer-overlay--open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`asistente-drawer${open ? ' asistente-drawer--open' : ''}`}
        role="dialog"
        aria-modal={open || undefined}
        aria-label="Asistente IA"
        aria-hidden={!open}
      >
        <header className="asistente-drawer__head">
          <span className="asistente-drawer__title">
            <IconoChispa />
            Asistente IA
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar asistente">
            <IconoCerrar />
          </button>
        </header>
        <div className="asistente-drawer__body">{cuerpo}</div>
      </aside>
    </>
  )
}
