// Lógica PURA del motor de sincronización (PLAN_OFFLINE.md §4).
//
// Acá no hay IndexedDB ni Supabase: solo funciones deterministas sobre datos.
// Eso las hace testeables con `deno test` sin navegador ni red (ver
// syncCore.test.ts), igual que reminderScheduling.ts / actions.ts.
//
// El motor con efectos (leer el outbox, hablar con Supabase, disparadores) vive
// en sync.ts y se apoya en estas funciones.

export type SyncEntity = 'tema' | 'item' | 'recordatorio'
export type SyncOpKind = 'insert' | 'update' | 'delete'

// Una fila del outbox tal como sale de IndexedDB (el subconjunto que necesita
// la lógica pura; el tipo completo con createdAt/lastError vive en db.ts).
export interface QueuedOp {
  seq: number
  entity: SyncEntity
  op: SyncOpKind
  entityId: string
  payload: Record<string, unknown> | null
  baseUpdatedAt: string | null
  tries: number
}

// Una operación ya planificada: puede cubrir VARIAS filas del outbox (las que
// se colapsaron en una sola escritura). `seqs` son todas esas filas: al aplicar
// con éxito se borran juntas.
export interface PlannedOp {
  seq: number // seq de la primera fila del grupo → define el orden FIFO
  seqs: number[]
  entity: SyncEntity
  op: SyncOpKind
  entityId: string
  payload: Record<string, unknown> | null
  baseUpdatedAt: string | null
  tries: number
}

export interface OutboxPlan {
  // Ops a aplicar contra el servidor, en orden FIFO.
  toApply: PlannedOp[]
  // Filas del outbox que se descartan SIN tocar el servidor (se cancelaron
  // entre sí). Se borran del outbox tal cual.
  toDrop: number[]
}

// Estado intermedio del plegado de un grupo (todas las ops de una entidad).
type FoldedOp = Omit<PlannedOp, 'seq' | 'seqs'>
type Folded = FoldedOp | null

function start(op: QueuedOp): FoldedOp {
  return {
    entity: op.entity,
    op: op.op,
    entityId: op.entityId,
    payload: op.payload ? { ...op.payload } : null,
    baseUpdatedAt: op.baseUpdatedAt,
    tries: op.tries,
  }
}

// Pliega una op nueva sobre lo acumulado del mismo entityId.
//
// Reglas (PLAN_OFFLINE.md §3.2):
//  - insert + update(s)  → un solo insert con el estado final.
//  - update + update(s)  → un solo update con los patches mergeados; conserva el
//    baseUpdatedAt del PRIMERO (es el que tenía la fila antes de editarla) y el
//    updated_at del ÚLTIMO (viene dentro del payload y pisa al anterior).
//  - update(s) + delete  → solo el delete (los updates no aportan nada).
//  - insert + delete     → ver nota abajo.
function fold(prev: Folded, op: QueuedOp): Folded {
  if (!prev) return start(op)
  const tries = Math.max(prev.tries, op.tries)

  if (op.op === 'insert') return { ...start(op), tries }

  if (op.op === 'update') {
    // Un update posterior a un delete no tiene sentido (la fila ya no existe);
    // lo ignoramos en vez de resucitarla.
    if (prev.op === 'delete') return { ...prev, tries }
    return {
      ...prev,
      payload: { ...(prev.payload ?? {}), ...(op.payload ?? {}) },
      tries,
    }
  }

  // delete
  if (prev.op === 'insert') {
    // Insert nunca intentado (tries === 0) → el servidor no puede tener la
    // fila, así que insert y delete se cancelan entre sí y no se manda nada.
    //
    // Si el insert YA se intentó (tries > 0) NO cancelamos: pudo haberse
    // aplicado en el servidor y haberse perdido la respuesta ("ack perdido"),
    // en cuyo caso cancelar dejaría una fila huérfana que el re-fetch volvería
    // a bajar y el usuario vería reaparecer lo que borró. Mandamos solo el
    // delete, que es idempotente (borrar algo que no existe no es error).
    if (prev.tries === 0) return null
    return { ...start(op), tries }
  }
  return { ...start(op), tries }
}

// Agrupa el outbox por entidad, colapsa las ops redundantes y devuelve el plan
// en orden FIFO. El orden lo fija el `seq` MÁS VIEJO de cada grupo, así se
// respetan las dependencias causales (tema → item → recordatorio), que es el
// orden en el que la UI las crea.
export function planOutbox(ops: QueuedOp[]): OutboxPlan {
  const sorted = [...ops].sort((a, b) => a.seq - b.seq)

  interface Group {
    anchor: number
    seqs: number[]
    folded: Folded
  }
  const groups = new Map<string, Group>()
  const order: string[] = []

  for (const op of sorted) {
    const key = `${op.entity}:${op.entityId}`
    let g = groups.get(key)
    if (!g) {
      g = { anchor: op.seq, seqs: [], folded: null }
      groups.set(key, g)
      order.push(key)
    }
    g.seqs.push(op.seq)
    g.folded = fold(g.folded, op)
  }

  const toApply: PlannedOp[] = []
  const toDrop: number[] = []

  for (const key of order) {
    const g = groups.get(key)!
    if (!g.folded) {
      toDrop.push(...g.seqs)
      continue
    }
    toApply.push({ ...g.folded, seq: g.anchor, seqs: [...g.seqs] })
  }

  toApply.sort((a, b) => a.seq - b.seq)
  toDrop.sort((a, b) => a - b)
  return { toApply, toDrop }
}

// ============================================================
// LWW condicional (PLAN_OFFLINE.md §4.3)
// ============================================================

export type ConditionalUpdateOutcome =
  | 'applied' // mi edición era la más reciente: ganó
  | 'server-newer' // el servidor tiene algo más nuevo: descarto mi cambio
  | 'deleted-on-server' // la fila ya no existe: gana el borrado

// El UPDATE va con guarda `updated_at <= :clientUpdatedAt`. Si afecta filas,
// mi cambio ganó. Si afecta 0 filas hay DOS causas posibles y se distinguen con
// un select de control: la fila existe (el servidor tiene una versión más
// nueva) o no existe (la borraron en el servidor).
export function resolveConditionalUpdate(
  rowsAffected: number,
  existsOnServer: boolean,
): ConditionalUpdateOutcome {
  if (rowsAffected > 0) return 'applied'
  return existsOnServer ? 'server-newer' : 'deleted-on-server'
}

// ============================================================
// Clasificación de errores (PLAN_OFFLINE.md §4.2)
// ============================================================

export type SyncErrorKind =
  | 'network' // sin red / servidor caído → reintentar tal cual
  | 'auth' // token vencido → reintentar tras reloguear, sin perder el outbox
  | 'dependency' // falta el padre en el servidor (FK/RLS) → reintentar después del padre
  | 'permanent' // no se va a arreglar sola (validación, etc.) → marcar y seguir

// Códigos de Postgres que indican "el padre todavía no está en el servidor":
// 23503 foreign_key_violation, 23502 not_null_violation, 42501 la RLS de
// `recordatorios` (que valida por join a `items`) rechaza si el item no existe.
const DEPENDENCY_CODES = new Set(['23503', '23502', '42501'])

export function classifySyncError(err: unknown): SyncErrorKind {
  const e = (err ?? {}) as { code?: string; message?: string; status?: number }
  const code = typeof e.code === 'string' ? e.code : ''
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : ''
  const status = typeof e.status === 'number' ? e.status : undefined

  if (DEPENDENCY_CODES.has(code) || msg.includes('row-level security')) return 'dependency'
  if (status === 401 || code === 'PGRST301' || msg.includes('jwt')) return 'auth'
  if (
    err instanceof TypeError ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('fetch failed')
  ) {
    return 'network'
  }
  if (status !== undefined && status >= 500) return 'network'
  return 'permanent'
}

// Un recordatorio no puede subir si su item padre falló antes (FK + RLS). En
// vez de descartarlo, se deja en cola y se reintenta en el próximo ciclo, ya
// con el padre arriba.
export function blockedByParent(op: PlannedOp, blockedItemIds: ReadonlySet<string>): boolean {
  if (op.entity !== 'recordatorio') return false
  const itemId = op.payload?.item_id
  return typeof itemId === 'string' && blockedItemIds.has(itemId)
}

// ============================================================
// Backoff
// ============================================================

const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60 * 1000

// Espera antes del próximo intento tras `fails` ciclos fallidos seguidos:
// 0, 5s, 10s, 20s, 40s… con techo de 5 min. Evita martillar al servidor.
export function backoffDelayMs(fails: number): number {
  if (fails <= 0) return 0
  return Math.min(BACKOFF_BASE_MS * 2 ** (fails - 1), BACKOFF_MAX_MS)
}
