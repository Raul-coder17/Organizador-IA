import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useAiEnabled } from '../lib/useAiEnabled'
import { supabase } from '../lib/supabase'
// Las acciones que confirma el usuario escriben por el repositorio local (igual
// que el CRUD manual): si la conexión se corta entre proponer y confirmar, el
// cambio no se pierde, queda encolado.
import {
  createItem,
  createTema,
  deleteItem,
  deleteRecordatoriosForItem,
  updateItem,
  upsertRecordatorio,
} from '../lib/repo'
import { loadItemsFromCache, loadTemasFromCache } from '../lib/db'
import { requestSync } from '../lib/sync'
import { useSyncStatus } from '../lib/useSyncStatus'
import { datetimeLocalToIso, formatFechaHora, isoToDatetimeLocal } from '../lib/recordatorios'
import type { Item, ItemInsert, LineaLista, Tema } from '../types/database'
import type { AccionPropuesta, AssistantResponse, AssistantUsage, ChatMessage } from '../types/assistant'

function contenidoTexto(item: Item): string {
  return typeof item.contenido?.texto === 'string' ? item.contenido.texto : JSON.stringify(item.contenido)
}

// Estado de cada acción propuesta en el preview (una tarjeta por acción).
type EstadoAccion = 'idle' | 'applying' | 'done' | 'cancelled' | 'error'
interface PendingAction {
  accion: AccionPropuesta
  estado: EstadoAccion
  error?: string
}

// El aviso de "sin conexión" del asistente.
//
// Es el contrapeso de la mejora en `useAiEnabled`: el botón que trae hasta acá
// ahora se dibuja habilitado sin red (refleja el último estado conocido de la
// IA, no un apagón inventado), así que la explicación de por qué el asistente
// no responde tiene que estar en esta pantalla, arriba de todo y con todas las
// letras. Un banner y no un error de red genérico ni un rebote a Ajustes: el
// problema no es la configuración de la IA, es que no hay internet, y son dos
// arreglos distintos.
//
// Va en las DOS salidas de la página (IA apagada y chat normal), porque sin
// señal el estado de la IA que estamos mostrando es el último conocido y el
// hecho que manda es la falta de red.
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

export function AssistantPage() {
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
  const [usage, setUsage] = useState<AssistantUsage | null>(null)
  const [cooldown, setCooldown] = useState(0) // segundos restantes de rate limit corto

  const scrollRef = useRef<HTMLDivElement>(null)

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

  if (!user) return null

  if (aiEnabled === false) {
    return (
      <main className="shell-main space-y-4">
        {!online && <AvisoSinConexion />}
        <div className="bg-card border border-line rounded-[4px] p-6 text-center">
          <p className="text-sm text-ink-soft mb-3">La IA no está activada.</p>
          <Link to="/settings" className="link-underline text-sm">
            Activá la IA en Ajustes para usar el asistente
          </Link>
        </div>
      </main>
    )
  }

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
    setPending([])

    const { data, error } = await supabase.functions.invoke<AssistantResponse>('ai-assistant', {
      body: {
        messages: history.map((m) => ({ role: m.role, text: m.text })),
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
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      text: data.respuesta_texto,
      acciones: acciones.length ? acciones : undefined,
    }
    setMessages((prev) => [...prev, assistantMsg])
    setPending(acciones.map((accion) => ({ accion, estado: 'idle' as EstadoAccion })))
    if (data.usage) setUsage(data.usage)

    // Rate limit por minuto: arrancamos la cuenta regresiva que bloquea el input.
    if (data.rate_limit?.kind === 'short' && data.rate_limit.retry_after_seconds) {
      setCooldown(data.rate_limit.retry_after_seconds)
    }
  }

  // Resuelve el nombre de tema que propuso la IA a un id, creándolo si no
  // existe. El tema creado por la IA sale con color automático igual que el
  // manual: el default vive en repo.createTema, no en el form (Fase 2, D4). Y
  // como la asignación lee el espejo local — donde el tema recién creado ya
  // está —, dos temas creados en la misma tanda de acciones no salen iguales.
  async function resolveTemaId(nombre: string | null | undefined): Promise<string | null> {
    if (!nombre) return null
    const existing = temas.find((t) => t.nombre.toLowerCase() === nombre.toLowerCase())
    if (existing) return existing.id
    const tema = await createTema(user!.id, nombre)
    setTemas((prev) => [...prev, tema].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    return tema.id
  }

  // Aplica una acción propuesta contra Supabase (reusa el mismo CRUD manual, así
  // que respeta RLS). Soporta listas (líneas) y recordatorios.
  async function applyAction(accion: AccionPropuesta): Promise<void> {
    if (accion.tipo_accion === 'create') {
      const tema_id = await resolveTemaId(accion.tema)
      let contenido: Record<string, unknown>
      if (accion.tipo === 'lista' && accion.lineas && accion.lineas.length > 0) {
        contenido = {
          items: accion.lineas.map((t) => ({ id: crypto.randomUUID(), texto: t, hecho: false })),
        }
      } else {
        contenido = { texto: accion.contenido ?? '' }
      }
      const payload: ItemInsert = {
        user_id: user!.id,
        tema_id,
        tipo: accion.tipo,
        prioridad: accion.prioridad,
        contenido,
        origen: 'texto',
      }
      const created = await createItem(payload)
      if (accion.recordatorio_fecha_hora) {
        await upsertRecordatorio(created.id, datetimeLocalToIso(accion.recordatorio_fecha_hora))
      }
      return
    }

    if (accion.tipo_accion === 'update') {
      const c = accion.cambios
      const current = items.find((it) => it.id === accion.item_id)
      const patch: Partial<ItemInsert> = {}
      if (c.tipo) patch.tipo = c.tipo
      if (c.prioridad !== undefined) patch.prioridad = c.prioridad
      if ('tema' in c) patch.tema_id = await resolveTemaId(c.tema)
      if (c.contenido) patch.contenido = { texto: c.contenido }

      // Edición de líneas de lista: partimos del contenido actual del item.
      const editaLineas =
        c.lineas_agregar || c.lineas_quitar || c.lineas_marcar_hechas || c.lineas_desmarcar
      if (editaLineas) {
        const norm = (s: string) => s.trim().toLowerCase()
        let lineas: LineaLista[] = Array.isArray(current?.contenido.items)
          ? (current!.contenido.items as LineaLista[]).map((l) => ({
              id: typeof l.id === 'string' ? l.id : crypto.randomUUID(),
              texto: String(l.texto ?? ''),
              hecho: Boolean(l.hecho),
            }))
          : []
        if (c.lineas_quitar) {
          const rm = new Set(c.lineas_quitar.map(norm))
          lineas = lineas.filter((l) => !rm.has(norm(l.texto)))
        }
        if (c.lineas_marcar_hechas) {
          const mk = new Set(c.lineas_marcar_hechas.map(norm))
          lineas = lineas.map((l) => (mk.has(norm(l.texto)) ? { ...l, hecho: true } : l))
        }
        if (c.lineas_desmarcar) {
          const dm = new Set(c.lineas_desmarcar.map(norm))
          lineas = lineas.map((l) => (dm.has(norm(l.texto)) ? { ...l, hecho: false } : l))
        }
        if (c.lineas_agregar) {
          lineas = [
            ...lineas,
            ...c.lineas_agregar.map((t) => ({ id: crypto.randomUUID(), texto: t, hecho: false })),
          ]
        }
        patch.contenido = { items: lineas }
      }

      if (Object.keys(patch).length > 0) {
        await updateItem(accion.item_id, patch)
      }

      if (c.quitar_recordatorio) {
        await deleteRecordatoriosForItem(accion.item_id)
      } else if (c.recordatorio_fecha_hora) {
        await upsertRecordatorio(accion.item_id, datetimeLocalToIso(c.recordatorio_fecha_hora))
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

  // Aplica UNA acción (por índice) y actualiza su estado en la tarjeta.
  async function confirmOne(index: number): Promise<boolean> {
    const target = pending[index]
    if (!target || target.estado !== 'idle') return false

    setPending((prev) => prev.map((p, i) => (i === index ? { ...p, estado: 'applying' } : p)))
    setError(null)
    try {
      await applyAction(target.accion)
      setPending((prev) => prev.map((p, i) => (i === index ? { ...p, estado: 'done' } : p)))
      setMessages((prev) => [...prev, { role: 'assistant', text: notaOk(target.accion) }])
      await loadData()
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo aplicar el cambio.'
      setPending((prev) => prev.map((p, i) => (i === index ? { ...p, estado: 'error', error: msg } : p)))
      return false
    }
  }

  function cancelOne(index: number) {
    setPending((prev) => prev.map((p, i) => (i === index ? { ...p, estado: 'cancelled' } : p)))
  }

  async function confirmAll() {
    // Aplica secuencialmente todas las que sigan pendientes (idle).
    for (let i = 0; i < pending.length; i++) {
      if (pending[i]?.estado === 'idle') {
        // eslint-disable-next-line no-await-in-loop
        await confirmOne(i)
      }
    }
  }

  const anyApplying = pending.some((p) => p.estado === 'applying')
  const idleCount = pending.filter((p) => p.estado === 'idle').length

  return (
    <main className="shell-main shell-main--alto flex flex-col gap-4 max-w-[720px]">
      {!online && <AvisoSinConexion />}

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 min-h-[300px]">
        {messages.length === 0 && (
          <p className="text-sm text-ink-soft">
            Preguntale al asistente por tus items, o pedile que cree/edite/borre uno. Cualquier cambio
            te lo va a mostrar para confirmar antes de aplicarlo.
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
                items={items}
                onConfirm={() => confirmOne(i)}
                onCancel={() => cancelOne(i)}
              />
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-rust">{error}</p>}

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
    </main>
  )
}

function EstadoBadge({ estado, errorMsg }: { estado: EstadoAccion; errorMsg?: string }) {
  if (estado === 'done') return <p className="text-sm text-moss mt-3 font-mono">✓ Aplicado</p>
  if (estado === 'cancelled') return <p className="text-sm text-slate mt-3 font-mono">Cancelado</p>
  if (estado === 'error')
    return <p className="text-sm text-rust mt-3">{errorMsg ?? 'No se pudo aplicar.'}</p>
  return null
}

function ProposedActionCard({
  accion,
  estado,
  errorMsg,
  items,
  onConfirm,
  onCancel,
}: {
  accion: AccionPropuesta
  estado: EstadoAccion
  errorMsg?: string
  items: Item[]
  onConfirm: () => void
  onCancel: () => void
}) {
  const target = 'item_id' in accion ? items.find((it) => it.id === accion.item_id) : undefined
  const resuelto = estado === 'done' || estado === 'cancelled'

  return (
    <div className="bg-card border border-line border-l-4 border-l-moss rounded-[2px] p-4 text-left">
      {accion.tipo_accion === 'create' && (
        <>
          <p className="text-sm font-medium text-ink mb-2">Vas a crear este item:</p>
          <ul className="text-sm text-ink space-y-0.5">
            <li>
              <span className="text-ink-soft">Tipo:</span> {accion.tipo}
            </li>
            <li>
              <span className="text-ink-soft">Tema:</span> {accion.tema ?? 'sin tema'}
            </li>
            <li>
              <span className="text-ink-soft">Prioridad:</span> {accion.prioridad ?? 'sin prioridad'}
            </li>
            {accion.tipo === 'lista' && accion.lineas ? (
              <li>
                <span className="text-ink-soft">Líneas:</span>
                <ul className="list-disc ml-5 mt-1">
                  {accion.lineas.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </li>
            ) : (
              <li className="whitespace-pre-wrap">
                <span className="text-ink-soft">Contenido:</span> {accion.contenido}
              </li>
            )}
            {accion.recordatorio_fecha_hora && (
              <li>
                <span className="text-ink-soft">Recordatorio:</span>{' '}
                {formatFechaHora(accion.recordatorio_fecha_hora)}
              </li>
            )}
          </ul>
        </>
      )}

      {accion.tipo_accion === 'update' && (
        <>
          <p className="text-sm font-medium text-ink mb-2">Vas a editar este item:</p>
          {target && (
            <p className="text-sm text-ink-soft mb-2 whitespace-pre-wrap">Actual: {contenidoTexto(target)}</p>
          )}
          <ul className="text-sm text-ink space-y-0.5">
            {accion.cambios.tipo && (
              <li>
                <span className="text-ink-soft">Nuevo tipo:</span> {accion.cambios.tipo}
              </li>
            )}
            {'tema' in accion.cambios && (
              <li>
                <span className="text-ink-soft">Nuevo tema:</span> {accion.cambios.tema ?? 'sin tema'}
              </li>
            )}
            {accion.cambios.prioridad && (
              <li>
                <span className="text-ink-soft">Nueva prioridad:</span> {accion.cambios.prioridad}
              </li>
            )}
            {accion.cambios.contenido && (
              <li className="whitespace-pre-wrap">
                <span className="text-ink-soft">Nuevo contenido:</span> {accion.cambios.contenido}
              </li>
            )}
            {accion.cambios.lineas_agregar && (
              <li>
                <span className="text-ink-soft">Agregar líneas:</span>{' '}
                {accion.cambios.lineas_agregar.join(', ')}
              </li>
            )}
            {accion.cambios.lineas_quitar && (
              <li>
                <span className="text-ink-soft">Quitar líneas:</span>{' '}
                {accion.cambios.lineas_quitar.join(', ')}
              </li>
            )}
            {accion.cambios.lineas_marcar_hechas && (
              <li>
                <span className="text-ink-soft">Marcar hechas:</span>{' '}
                {accion.cambios.lineas_marcar_hechas.join(', ')}
              </li>
            )}
            {accion.cambios.lineas_desmarcar && (
              <li>
                <span className="text-ink-soft">Desmarcar:</span>{' '}
                {accion.cambios.lineas_desmarcar.join(', ')}
              </li>
            )}
            {accion.cambios.recordatorio_fecha_hora && (
              <li>
                <span className="text-ink-soft">Recordatorio:</span>{' '}
                {formatFechaHora(accion.cambios.recordatorio_fecha_hora)}
              </li>
            )}
            {accion.cambios.quitar_recordatorio && (
              <li>
                <span className="text-ink-soft">Recordatorio:</span> quitar
              </li>
            )}
          </ul>
        </>
      )}

      {accion.tipo_accion === 'delete' && (
        <>
          <p className="text-sm font-medium text-ink mb-2">Vas a borrar este item:</p>
          <p className="text-sm text-ink whitespace-pre-wrap">
            {target ? contenidoTexto(target) : `Item ${accion.item_id}`}
          </p>
        </>
      )}

      {resuelto || estado === 'error' ? (
        <EstadoBadge estado={estado} errorMsg={errorMsg} />
      ) : (
        <div className="flex items-center gap-4 mt-4">
          <button onClick={onConfirm} disabled={estado === 'applying'} className="btn-moss">
            {estado === 'applying' ? 'Aplicando…' : 'Confirmar'}
          </button>
          <button onClick={onCancel} disabled={estado === 'applying'} className="btn-ghost">
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}
