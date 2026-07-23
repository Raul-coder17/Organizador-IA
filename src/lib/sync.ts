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
const listeners = new Set<Listener>()

// Aviso de "ya podés releer el espejo local": lo emitimos al terminar cada
// ciclo de sync, haya cambiado algo o no. Las pantallas se resuscriben y
// recargan desde IndexedDB. (El indicador visual de estado es el ítem 7.)
export function subscribeSyncSettled(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emitSettled(): void {
  settledOnce = true
  for (const cb of listeners) {
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

// Devuelve true si el outbox quedó vacío (condición para reconciliar).
async function flushOutbox(): Promise<boolean> {
  const { toApply, toDrop } = planOutbox(await getOutbox())
  await deleteOps(toDrop)

  // Items cuya op falló en este ciclo: sus recordatorios no pueden subir
  // todavía (FK + RLS), así que se saltean y se reintentan en el próximo.
  const blockedItems = new Set<string>()
  let pendientes = 0

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
    } catch (err) {
      const kind = classifySyncError(err)
      await markOpsFailed(op.seqs, errorMessage(err))
      pendientes++
      if (op.entity === 'item') blockedItems.add(op.entityId)

      // Sin red o sin auth no tiene sentido seguir intentando el resto del
      // outbox en este ciclo: cortamos y reintentamos entero más tarde.
      if (kind === 'network' || kind === 'auth') throw err
      // 'dependency' y 'permanent' quedan marcadas y seguimos con las demás
      // ops, que pueden ser independientes.
    }
  }

  return pendientes === 0 && (await countOutbox()) === 0
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
  await setMeta('lastSyncAt', new Date().toISOString())
}

// ============================================================
// Ciclo completo + single-flight
// ============================================================

async function runSync(userId: string): Promise<void> {
  try {
    const drained = await flushOutbox()
    if (drained) await reconcile(userId)
    consecutiveFails = 0
    nextAttemptAt = 0
  } catch (err) {
    // El outbox NO se pierde: las ops fallidas siguen en cola con su contador
    // de intentos. Backoff para no martillar mientras el problema persista.
    consecutiveFails++
    nextAttemptAt = Date.now() + backoffDelayMs(consecutiveFails)
    console.warn('[sync] ciclo fallido:', errorMessage(err))
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
export function requestSync(): void {
  if (typeof window === 'undefined') {
    void syncNow()
    return
  }
  window.clearTimeout(debounceId)
  debounceId = window.setTimeout(() => void syncNow(), DEBOUNCE_MS)
}

// ============================================================
// Arranque / disparadores
// ============================================================

// Engancha los disparadores y hace el primer sync. Devuelve el cleanup.
export function startSyncEngine(userId: string): () => void {
  currentUserId = userId

  const onOnline = () => {
    // Volvió la red: reseteamos el backoff para subir enseguida.
    consecutiveFails = 0
    nextAttemptAt = 0
    void syncNow()
  }
  const onFocus = () => void syncNow()
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  const intervalId = window.setInterval(() => void syncNow(), RETRY_MS)

  void syncNow()

  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    window.clearInterval(intervalId)
    window.clearTimeout(debounceId)
    currentUserId = null
  }
}
