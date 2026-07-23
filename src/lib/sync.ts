// Motor de sincronización (PLAN_OFFLINE.md ítem 6 / §4).
//
// Ciclo de un sync, siempre en este orden:
//   1) FLUSH — vacía el `outbox` contra Supabase, op por op, en orden FIFO,
//      con upsert idempotente para los insert y escritura condicional LWW para
//      los update (§4.3).
//   2) RECONCILE — solo si el outbox quedó vacío, re-fetch completo de
//      temas/items/recordatorios y reemplazo del espejo local. Nunca al revés:
//      bajar antes de subir pisaría cambios locales sin sincronizar (§4.4).
//
// Disparadores: evento `online`, foco/visibilidad de la pestaña, un intervalo
// de reintento, el arranque de la app y cada mutación nueva (requestSync).
// Un solo sync a la vez entre TODAS las pestañas, vía Web Locks (§4.1).
//
// La lógica pura (plan del outbox, LWW, clasificación de errores, backoff) vive
// en syncCore.ts y está testeada aparte.

import { supabase } from './supabase'
import {
  countOutbox,
  deleteLocalRow,
  deleteOps,
  getMeta,
  getOutbox,
  markOpsFailed,
  saveItemsToCache,
  saveRecordatoriosToCache,
  saveTemasToCache,
  setMeta,
} from './db'
import { listItems } from './items'
import { listTemas } from './temas'
import { listRecordatorios, toPlainRecordatorio } from './recordatorios'
import {
  backoffDelayMs,
  blockedByParent,
  classifySyncError,
  planOutbox,
  resolveConditionalUpdate,
  type PlannedOp,
  type SyncEntity,
  type SyncErrorKind,
} from './syncCore'

const SYNC_LOCK = 'organizador-sync'
const RETRY_MS = 30_000
// Pequeña espera tras una mutación para que una ráfaga (crear item + su
// recordatorio, tildar varias líneas) se suba en un solo ciclo.
const DEBOUNCE_MS = 200

const TABLE: Record<SyncEntity, string> = {
  tema: 'temas',
  item: 'items',
  recordatorio: 'recordatorios',
}

// ============================================================
// Estado del módulo
// ============================================================

let currentUserId: string | null = null
let inFlight = false
let settledOnce = false
let consecutiveFails = 0
let nextAttemptAt = 0
let debounceId: number | undefined

type Listener = () => void

// Aviso de "ya podés releer el espejo local": lo emitimos al terminar cada
// ciclo de sync, haya cambiado algo o no. Las pantallas se resuscriben y
// recargan desde IndexedDB.
const settledListeners = new Set<Listener>()

export function subscribeSyncSettled(cb: Listener): () => void {
  settledListeners.add(cb)
  return () => {
    settledListeners.delete(cb)
  }
}

function emitSettled(): void {
  settledOnce = true
  for (const cb of settledListeners) {
    try {
      cb()
    } catch {
      /* un suscriptor roto no puede tumbar el motor */
    }
  }
}

// ¿Ya terminó al menos un ciclo de sync en esta sesión? Las pantallas lo usan
// para decidir si un espejo vacío significa "todavía cargando" o "no hay nada".
export function hasSyncSettled(): boolean {
  return settledOnce
}

// ============================================================
// Estado observable (PLAN_OFFLINE.md ítem 7 / §5)
// ============================================================

export interface SyncState {
  online: boolean
  // Hay un ciclo de sync corriendo ahora mismo.
  running: boolean
  // Operaciones en el outbox todavía sin subir.
  pending: number
  // ISO del último ciclo que terminó con el outbox vacío y el espejo al día.
  lastSyncAt: string | null
  // Mensaje listo para mostrar; null si no hay nada que reportar.
  error: string | null
}

// Mensajes cortos: el indicador de la nav es una píldora, no un párrafo (una
// etiqueta larga se parte en dos renglones a 375px y engorda la barra).
const ERROR_LABEL: Record<SyncErrorKind, string> = {
  auth: 'Sesión vencida — reingresá',
  network: 'No se pudo sincronizar',
  dependency: 'No se pudo sincronizar',
  permanent: 'Un cambio no se pudo guardar',
}

let state: SyncState = {
  online: typeof navigator === 'undefined' || navigator.onLine !== false,
  running: false,
  pending: 0,
  lastSyncAt: null,
  error: null,
}

const stateListeners = new Set<Listener>()

// La referencia solo cambia si cambió algún campo: así `useSyncExternalStore`
// puede descartar las notificaciones que no mueven la aguja.
export function getSyncState(): SyncState {
  return state
}

export function subscribeSync(cb: Listener): () => void {
  stateListeners.add(cb)
  return () => {
    stateListeners.delete(cb)
  }
}

function setState(patch: Partial<SyncState>): void {
  const next = { ...state, ...patch }
  if (
    next.online === state.online &&
    next.running === state.running &&
    next.pending === state.pending &&
    next.lastSyncAt === state.lastSyncAt &&
    next.error === state.error
  ) {
    return
  }
  state = next
  for (const cb of stateListeners) {
    try {
      cb()
    } catch {
      /* un suscriptor roto no puede tumbar el motor */
    }
  }
}

async function refreshPending(): Promise<void> {
  try {
    setState({ pending: await countOutbox() })
  } catch {
    /* el conteo es informativo: si falla, no rompemos el ciclo */
  }
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ============================================================
// Aplicación de una operación contra Supabase
// ============================================================

type ApplyOutcome = 'applied' | 'server-newer' | 'deleted-on-server'

async function applyOp(op: PlannedOp): Promise<ApplyOutcome> {
  const table = TABLE[op.entity]

  if (op.op === 'insert') {
    // Upsert por id (el UUID ya lo generó el cliente): reintentar un insert que
    // sí se había aplicado no duplica ni falla (§3.3).
    const { error } = await supabase.from(table).upsert(op.payload ?? {}, { onConflict: 'id' })
    if (error) throw error
    return 'applied'
  }

  if (op.op === 'delete') {
    // Borrado duro e idempotente: si la fila ya no está, no es error (§3.5).
    const { error } = await supabase.from(table).delete().eq('id', op.entityId)
    if (error) throw error
    return 'applied'
  }

  const patch = { ...(op.payload ?? {}) }
  const clientUpdatedAt = typeof patch.updated_at === 'string' ? patch.updated_at : null

  if (!clientUpdatedAt) {
    // `temas` no tiene updated_at (no se editan en la UI). Sin columna de
    // tiempo no hay guarda LWW posible: escritura directa.
    const { error } = await supabase.from(table).update(patch).eq('id', op.entityId)
    if (error) throw error
    return 'applied'
  }

  // Escritura condicional: solo aplica si el servidor NO tiene algo más nuevo
  // que mi edición.
  const { data, error } = await supabase
    .from(table)
    .update(patch)
    .eq('id', op.entityId)
    .lte('updated_at', clientUpdatedAt)
    .select('id')
  if (error) throw error
  if ((data?.length ?? 0) > 0) return 'applied'

  // 0 filas afectadas: hay que distinguir "el servidor tiene algo más nuevo"
  // de "la fila ya no existe" con un select de control.
  const { data: control, error: controlError } = await supabase
    .from(table)
    .select('id')
    .eq('id', op.entityId)
    .maybeSingle()
  if (controlError) throw controlError

  return resolveConditionalUpdate(0, control !== null)
}

// ============================================================
// Flush del outbox
// ============================================================

interface FlushResult {
  // El outbox quedó vacío (condición para reconciliar).
  drained: boolean
  // Una op que falló con un error que no se va a arreglar sola: se queda en la
  // cola y hay que contárselo al usuario, porque si no ve "N sin sincronizar"
  // para siempre y sin explicación.
  stuck: string | null
}

async function flushOutbox(): Promise<FlushResult> {
  const { toApply, toDrop } = planOutbox(await getOutbox())
  await deleteOps(toDrop)

  // Items cuya op falló en este ciclo: sus recordatorios no pueden subir
  // todavía (FK + RLS), así que se saltean y se reintentan en el próximo.
  const blockedItems = new Set<string>()
  let pendientes = 0
  let stuck: string | null = null

  for (const op of toApply) {
    if (blockedByParent(op, blockedItems)) {
      pendientes++
      continue
    }

    try {
      const outcome = await applyOp(op)
      // Aplicada (o resuelta por LWW en contra): en los tres casos la op deja
      // de tener sentido y sale del outbox.
      await deleteOps(op.seqs)
      if (outcome === 'deleted-on-server') {
        // Ganó el borrado del servidor: limpiamos la fila local.
        await deleteLocalRow(op.entity, op.entityId)
      }
      // El contador baja op por op, así se ve avanzar la cola.
      await refreshPending()
    } catch (err) {
      const kind = classifySyncError(err)
      await markOpsFailed(op.seqs, errorMessage(err))
      pendientes++
      if (op.entity === 'item') blockedItems.add(op.entityId)

      // Sin red o sin auth no tiene sentido seguir intentando el resto del
      // outbox en este ciclo: cortamos y reintentamos entero más tarde.
      if (kind === 'network' || kind === 'auth') throw err
      // 'dependency' se resuelve sola en el próximo ciclo (una vez que suba el
      // padre); 'permanent' no, así que esa sí se reporta.
      if (kind === 'permanent') stuck = ERROR_LABEL.permanent
    }
  }

  return { drained: pendientes === 0 && (await countOutbox()) === 0, stuck }
}

// ============================================================
// Reconciliación (re-fetch completo)
// ============================================================

async function reconcile(userId: string): Promise<void> {
  const [temas, items, recordatorios] = await Promise.all([
    listTemas(userId),
    listItems(userId),
    listRecordatorios(),
  ])
  // Si mientras bajábamos entró una mutación nueva, no pisamos el espejo (nos
  // llevaríamos por delante una escritura optimista todavía sin subir). El
  // próximo ciclo sube esa op y reconcilia con el servidor ya al día.
  if ((await countOutbox()) > 0) return
  // Reemplazo total del espejo: así también se ven los borrados hechos desde
  // otro dispositivo, sin necesidad de tombstones (§4.4).
  await saveTemasToCache(temas)
  await saveItemsToCache(items)
  await saveRecordatoriosToCache(recordatorios.map(toPlainRecordatorio))

  // Solo acá se estampa `lastSyncAt`: es el único punto donde el outbox quedó
  // vacío Y el espejo quedó igual al servidor.
  const ts = new Date().toISOString()
  await setMeta('lastSyncAt', ts)
  setState({ lastSyncAt: ts })
}

// ============================================================
// Ciclo completo + single-flight
// ============================================================

async function runSync(userId: string): Promise<void> {
  setState({ running: true })
  try {
    const { drained, stuck } = await flushOutbox()
    if (drained) await reconcile(userId)
    consecutiveFails = 0
    nextAttemptAt = 0
    setState({ error: stuck })
  } catch (err) {
    // El outbox NO se pierde: las ops fallidas siguen en cola con su contador
    // de intentos. Backoff para no martillar mientras el problema persista.
    consecutiveFails++
    nextAttemptAt = Date.now() + backoffDelayMs(consecutiveFails)
    const kind = classifySyncError(err)
    console.warn('[sync] ciclo fallido:', errorMessage(err))
    // Un fallo aislado de red puede ser un parpadeo y no vale molestar: lo
    // mostramos recién al segundo seguido. El de auth sí desde el primero,
    // porque no se arregla reintentando (hay que reloguear).
    if (kind === 'auth' || consecutiveFails >= 2) setState({ error: ERROR_LABEL[kind] })
  } finally {
    await refreshPending()
    setState({ running: false })
  }
}

// Un solo sync a la vez, incluso con varias pestañas abiertas sobre el mismo
// IndexedDB: si otra ya tiene el lock, esta pasa de largo (`ifAvailable`).
async function withLock(fn: () => Promise<void>): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    await navigator.locks.request(SYNC_LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) return
      await fn()
    })
    return
  }
  // Navegador sin Web Locks: guard en memoria (cubre solo esta pestaña).
  if (inFlight) return
  inFlight = true
  try {
    await fn()
  } finally {
    inFlight = false
  }
}

// Corre un ciclo de sync ahora, si corresponde. Nunca lanza.
export async function syncNow(): Promise<void> {
  const userId = currentUserId
  try {
    if (!userId) return
    if (!isOnline()) return
    if (Date.now() < nextAttemptAt) return
    await withLock(() => runSync(userId))
  } finally {
    // Siempre avisamos, incluso si el ciclo se salteó: las pantallas esperan
    // esta señal para dejar de mostrar "Cargando…" cuando el espejo está vacío.
    emitSettled()
  }
}

// Pide un sync tras una mutación local. Debounce corto para agrupar ráfagas.
// El conteo de pendientes se refresca YA (sin esperar al debounce) para que el
// indicador reaccione en el mismo instante en que el usuario guarda.
export function requestSync(): void {
  void refreshPending()
  if (typeof window === 'undefined') {
    void syncNow()
    return
  }
  window.clearTimeout(debounceId)
  debounceId = window.setTimeout(() => void syncNow(), DEBOUNCE_MS)
}

// Sync a pedido del usuario (botón "Sincronizar ahora"): saltea el backoff.
export async function forceSyncNow(): Promise<void> {
  consecutiveFails = 0
  nextAttemptAt = 0
  await syncNow()
}

// ============================================================
// Arranque / disparadores
// ============================================================

// Engancha los disparadores y hace el primer sync. Devuelve el cleanup.
export function startSyncEngine(userId: string): () => void {
  currentUserId = userId

  const onOnline = () => {
    // Volvió la red: reseteamos el backoff para subir enseguida y limpiamos el
    // error, que a esta altura ya es historia vieja.
    consecutiveFails = 0
    nextAttemptAt = 0
    setState({ online: true, error: null })
    void syncNow()
  }
  // Estar sin conexión no es un error: es un estado, y tiene su propio cartel.
  const onOffline = () => setState({ online: false, error: null })
  const onFocus = () => void syncNow()
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  const intervalId = window.setInterval(() => void syncNow(), RETRY_MS)

  // Estado inicial del indicador: conexión, pendientes en cola y la última
  // sincronización que quedó guardada de la sesión anterior.
  setState({ online: isOnline() })
  void refreshPending()
  void getMeta<string>('lastSyncAt').then((ts) => setState({ lastSyncAt: ts }))

  void syncNow()

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    window.clearInterval(intervalId)
    window.clearTimeout(debounceId)
    currentUserId = null
  }
}
