import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useAiEnabled } from '../lib/useAiEnabled'
import { supabase } from '../lib/supabase'
import { listItems, createItem, updateItem, deleteItem } from '../lib/items'
import { listTemas, createTema } from '../lib/temas'
import type { Item, ItemInsert, Tema } from '../types/database'
import type { AccionPropuesta, AssistantResponse, AssistantUsage, ChatMessage } from '../types/assistant'
import { AppNav } from '../components/AppNav'

function contenidoTexto(item: Item): string {
  return typeof item.contenido?.texto === 'string' ? item.contenido.texto : JSON.stringify(item.contenido)
}

export function AssistantPage() {
  const { user } = useAuth()
  const aiEnabled = useAiEnabled()

  const [items, setItems] = useState<Item[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<AccionPropuesta | null>(null)
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
    const [itemsData, temasData] = await Promise.all([listItems(user.id), listTemas(user.id)])
    setItems(itemsData)
    setTemas(temasData)
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
      <div className="min-h-screen bg-paper">
        <AppNav />
        <main className="max-w-2xl mx-auto px-6 py-8">
          <div className="bg-card border border-line rounded-[2px] p-6 text-center">
            <p className="text-sm text-ink-soft mb-3">La IA no está activada.</p>
            <Link to="/settings" className="link-underline text-sm">
              Activá la IA en Settings para usar el asistente
            </Link>
          </div>
        </main>
      </div>
    )
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return

    const userMsg: ChatMessage = { role: 'user', text }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setSending(true)
    setError(null)
    setPending(null)

    const { data, error } = await supabase.functions.invoke<AssistantResponse>('ai-assistant', {
      body: { messages: history.map((m) => ({ role: m.role, text: m.text })) },
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

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      text: data.respuesta_texto,
      accion: data.accion_propuesta,
    }
    setMessages((prev) => [...prev, assistantMsg])
    if (data.accion_propuesta) setPending(data.accion_propuesta)
    if (data.usage) setUsage(data.usage)

    // Rate limit por minuto: arrancamos la cuenta regresiva que bloquea el input.
    if (data.rate_limit?.kind === 'short' && data.rate_limit.retry_after_seconds) {
      setCooldown(data.rate_limit.retry_after_seconds)
    }
  }

  async function resolveTemaId(nombre: string | null | undefined): Promise<string | null> {
    if (!nombre) return null
    const existing = temas.find((t) => t.nombre.toLowerCase() === nombre.toLowerCase())
    if (existing) return existing.id
    const tema = await createTema(user!.id, nombre)
    setTemas((prev) => [...prev, tema].sort((a, b) => a.nombre.localeCompare(b.nombre)))
    return tema.id
  }

  async function handleConfirm() {
    if (!pending) return
    setExecuting(true)
    setError(null)

    try {
      let nota = ''

      if (pending.tipo_accion === 'create') {
        const tema_id = await resolveTemaId(pending.tema)
        const payload: ItemInsert = {
          user_id: user!.id,
          tema_id,
          tipo: pending.tipo,
          prioridad: pending.prioridad,
          contenido: { texto: pending.contenido },
          origen: 'texto',
        }
        await createItem(payload)
        nota = 'Listo, creé el item.'
      } else if (pending.tipo_accion === 'update') {
        const patch: Partial<ItemInsert> = {}
        if (pending.cambios.tipo) patch.tipo = pending.cambios.tipo
        if (pending.cambios.prioridad !== undefined) patch.prioridad = pending.cambios.prioridad
        if ('tema' in pending.cambios) patch.tema_id = await resolveTemaId(pending.cambios.tema)
        if (pending.cambios.contenido) patch.contenido = { texto: pending.cambios.contenido }
        await updateItem(pending.item_id, patch)
        nota = 'Listo, actualicé el item.'
      } else {
        await deleteItem(pending.item_id)
        nota = 'Listo, borré el item.'
      }

      setPending(null)
      setMessages((prev) => [...prev, { role: 'assistant', text: nota }])
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aplicar el cambio.')
    } finally {
      setExecuting(false)
    }
  }

  function handleCancel() {
    setPending(null)
    setMessages((prev) => [...prev, { role: 'assistant', text: 'Cancelado, no hice ningún cambio.' }])
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      <AppNav />

      <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-8 flex flex-col gap-4">
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

          {pending && (
            <ProposedActionCard
              accion={pending}
              items={items}
              executing={executing}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
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
            placeholder={cooldown > 0 ? `Esperá ${cooldown}s…` : 'Escribí un mensaje…'}
            disabled={sending || cooldown > 0}
            className="ctl flex-1 disabled:opacity-60"
          />
          <button type="submit" disabled={sending || cooldown > 0 || !input.trim()} className="btn-moss">
            Enviar
          </button>
        </form>

        {usage?.daily_quota != null && (
          <p className="text-xs text-slate text-right font-mono">
            {usage.used_today ?? 0} de {usage.daily_quota} mensajes de IA usados hoy
          </p>
        )}
      </main>
    </div>
  )
}

function ProposedActionCard({
  accion,
  items,
  executing,
  onConfirm,
  onCancel,
}: {
  accion: AccionPropuesta
  items: Item[]
  executing: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const target = 'item_id' in accion ? items.find((it) => it.id === accion.item_id) : undefined

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
            <li className="whitespace-pre-wrap">
              <span className="text-ink-soft">Contenido:</span> {accion.contenido}
            </li>
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

      <div className="flex items-center gap-4 mt-4">
        <button onClick={onConfirm} disabled={executing} className="btn-moss">
          {executing ? 'Aplicando…' : 'Confirmar'}
        </button>
        <button onClick={onCancel} disabled={executing} className="btn-ghost">
          Cancelar
        </button>
      </div>
    </div>
  )
}
