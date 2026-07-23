// Tests de la lógica pura del motor de sincronización (PLAN_OFFLINE.md §4).
// Correr con: npx deno test src/lib/syncCore.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import {
  backoffDelayMs,
  blockedByParent,
  classifySyncError,
  formatHaceCuanto,
  planOutbox,
  resolveConditionalUpdate,
  type PlannedOp,
  type QueuedOp,
} from './syncCore.ts'

const T0 = '2026-07-22T12:00:00.000Z'
const T1 = '2026-07-22T12:01:00.000Z'
const T2 = '2026-07-22T12:02:00.000Z'

function op(partial: Partial<QueuedOp> & Pick<QueuedOp, 'seq' | 'entity' | 'op' | 'entityId'>): QueuedOp {
  return {
    payload: null,
    baseUpdatedAt: null,
    tries: 0,
    ...partial,
  }
}

// ============================================================
// planOutbox — orden FIFO y dependencias causales
// ============================================================

Deno.test('planOutbox: respeta el orden FIFO (tema → item → recordatorio)', () => {
  const { toApply, toDrop } = planOutbox([
    op({ seq: 3, entity: 'recordatorio', op: 'insert', entityId: 'r1', payload: { item_id: 'i1' } }),
    op({ seq: 1, entity: 'tema', op: 'insert', entityId: 't1', payload: { id: 't1' } }),
    op({ seq: 2, entity: 'item', op: 'insert', entityId: 'i1', payload: { id: 'i1', tema_id: 't1' } }),
  ])
  assertEquals(toDrop, [])
  assertEquals(
    toApply.map((o) => [o.entity, o.entityId]),
    [
      ['tema', 't1'],
      ['item', 'i1'],
      ['recordatorio', 'r1'],
    ],
  )
})

Deno.test('planOutbox: el orden lo fija el seq más viejo de cada entidad', () => {
  // El item i1 se creó primero (seq 1) y se editó después (seq 4): su escritura
  // sigue yendo antes que la del recordatorio que lo referencia (seq 2).
  const { toApply } = planOutbox([
    op({ seq: 1, entity: 'item', op: 'insert', entityId: 'i1', payload: { id: 'i1' } }),
    op({ seq: 2, entity: 'recordatorio', op: 'insert', entityId: 'r1', payload: { item_id: 'i1' } }),
    op({ seq: 4, entity: 'item', op: 'update', entityId: 'i1', payload: { updated_at: T1 } }),
  ])
  assertEquals(toApply.map((o) => o.entityId), ['i1', 'r1'])
  assertEquals(toApply[0].seqs, [1, 4])
})

// ============================================================
// planOutbox — colapso de ops redundantes
// ============================================================

Deno.test('planOutbox: insert + updates se colapsan en un solo insert final', () => {
  const { toApply } = planOutbox([
    op({ seq: 1, entity: 'item', op: 'insert', entityId: 'i1', payload: { id: 'i1', contenido: { texto: 'a' }, updated_at: T0 } }),
    op({ seq: 2, entity: 'item', op: 'update', entityId: 'i1', payload: { contenido: { texto: 'b' }, updated_at: T1 } }),
    op({ seq: 3, entity: 'item', op: 'update', entityId: 'i1', payload: { prioridad: 'alta', updated_at: T2 } }),
  ])
  assertEquals(toApply.length, 1)
  assertEquals(toApply[0].op, 'insert')
  assertEquals(toApply[0].seqs, [1, 2, 3])
  assertEquals(toApply[0].payload, {
    id: 'i1',
    contenido: { texto: 'b' },
    prioridad: 'alta',
    updated_at: T2,
  })
})

Deno.test('planOutbox: updates seguidos se mergean conservando el baseUpdatedAt original', () => {
  const { toApply } = planOutbox([
    op({ seq: 1, entity: 'item', op: 'update', entityId: 'i1', payload: { contenido: { texto: 'b' }, updated_at: T1 }, baseUpdatedAt: T0 }),
    op({ seq: 2, entity: 'item', op: 'update', entityId: 'i1', payload: { prioridad: 'baja', updated_at: T2 }, baseUpdatedAt: T1 }),
  ])
  assertEquals(toApply.length, 1)
  assertEquals(toApply[0].baseUpdatedAt, T0)
  // Gana el updated_at de la última edición: es el que usa la guarda LWW.
  assertEquals(toApply[0].payload, { contenido: { texto: 'b' }, prioridad: 'baja', updated_at: T2 })
})

Deno.test('planOutbox: updates seguidos de delete dejan solo el delete', () => {
  const { toApply, toDrop } = planOutbox([
    op({ seq: 1, entity: 'item', op: 'update', entityId: 'i1', payload: { updated_at: T1 } }),
    op({ seq: 2, entity: 'item', op: 'delete', entityId: 'i1' }),
  ])
  assertEquals(toDrop, [])
  assertEquals(toApply.length, 1)
  assertEquals(toApply[0].op, 'delete')
  assertEquals(toApply[0].seqs, [1, 2])
})

Deno.test('planOutbox: insert nunca enviado + delete se cancelan sin tocar la red', () => {
  const { toApply, toDrop } = planOutbox([
    op({ seq: 1, entity: 'item', op: 'insert', entityId: 'i1', payload: { id: 'i1' } }),
    op({ seq: 2, entity: 'item', op: 'update', entityId: 'i1', payload: { updated_at: T1 } }),
    op({ seq: 3, entity: 'item', op: 'delete', entityId: 'i1' }),
  ])
  assertEquals(toApply, [])
  assertEquals(toDrop, [1, 2, 3])
})

Deno.test('planOutbox: si el insert ya se intentó, el delete SÍ se manda (ack perdido)', () => {
  // tries > 0 significa que el insert pudo haberse aplicado en el servidor y
  // haberse perdido la respuesta: cancelarlo dejaría una fila huérfana.
  const { toApply, toDrop } = planOutbox([
    op({ seq: 1, entity: 'item', op: 'insert', entityId: 'i1', payload: { id: 'i1' }, tries: 2 }),
    op({ seq: 2, entity: 'item', op: 'delete', entityId: 'i1' }),
  ])
  assertEquals(toDrop, [])
  assertEquals(toApply.length, 1)
  assertEquals(toApply[0].op, 'delete')
  assertEquals(toApply[0].seqs, [1, 2])
})

Deno.test('planOutbox: entidades distintas con el mismo id no se mezclan', () => {
  const { toApply } = planOutbox([
    op({ seq: 1, entity: 'item', op: 'insert', entityId: 'x', payload: { id: 'x' } }),
    op({ seq: 2, entity: 'recordatorio', op: 'insert', entityId: 'x', payload: { id: 'x' } }),
  ])
  assertEquals(toApply.length, 2)
  assertEquals(toApply.map((o) => o.entity), ['item', 'recordatorio'])
})

Deno.test('planOutbox: outbox vacío devuelve un plan vacío', () => {
  assertEquals(planOutbox([]), { toApply: [], toDrop: [] })
})

// ============================================================
// Idempotencia de reintentos
// ============================================================

Deno.test('planOutbox: replanificar tras un fallo devuelve el mismo plan (idempotente)', () => {
  // Tras un ciclo fallido las ops siguen en el outbox con tries incrementado;
  // el plan que sale es el mismo, así que reintentar es seguro.
  const ops = [
    op({ seq: 1, entity: 'item', op: 'insert', entityId: 'i1', payload: { id: 'i1', updated_at: T0 } }),
    op({ seq: 2, entity: 'recordatorio', op: 'insert', entityId: 'r1', payload: { id: 'r1', item_id: 'i1' } }),
  ]
  const primero = planOutbox(ops)
  const reintento = planOutbox(ops.map((o) => ({ ...o, tries: o.tries + 1 })))

  assertEquals(
    reintento.toApply.map((o) => [o.entity, o.entityId, o.op, o.seqs]),
    primero.toApply.map((o) => [o.entity, o.entityId, o.op, o.seqs]),
  )
  assertEquals(reintento.toApply.map((o) => o.payload), primero.toApply.map((o) => o.payload))
})

Deno.test('planOutbox: aplicar y borrar las seqs deja el resto del plan intacto', () => {
  const ops = [
    op({ seq: 1, entity: 'tema', op: 'insert', entityId: 't1', payload: { id: 't1' } }),
    op({ seq: 2, entity: 'item', op: 'insert', entityId: 'i1', payload: { id: 'i1' } }),
  ]
  const aplicadas = new Set(planOutbox(ops).toApply[0].seqs)
  const restante = planOutbox(ops.filter((o) => !aplicadas.has(o.seq)))
  assertEquals(restante.toApply.map((o) => o.entityId), ['i1'])
})

// ============================================================
// LWW condicional (§4.3)
// ============================================================

Deno.test('resolveConditionalUpdate: 1 fila afectada = mi cambio ganó', () => {
  assertEquals(resolveConditionalUpdate(1, true), 'applied')
})

Deno.test('resolveConditionalUpdate: 0 filas + la fila existe = el servidor es más nuevo', () => {
  assertEquals(resolveConditionalUpdate(0, true), 'server-newer')
})

Deno.test('resolveConditionalUpdate: 0 filas + la fila no existe = borrada en el servidor', () => {
  assertEquals(resolveConditionalUpdate(0, false), 'deleted-on-server')
})

// ============================================================
// Clasificación de errores y bloqueo por dependencias (§4.2)
// ============================================================

Deno.test('classifySyncError: FK y RLS son dependencias (se reintentan tras el padre)', () => {
  assertEquals(classifySyncError({ code: '23503', message: 'violates foreign key constraint' }), 'dependency')
  assertEquals(classifySyncError({ code: '42501', message: 'new row violates row-level security policy' }), 'dependency')
})

Deno.test('classifySyncError: fallos de red', () => {
  assertEquals(classifySyncError(new TypeError('Failed to fetch')), 'network')
  assertEquals(classifySyncError({ message: 'NetworkError when attempting to fetch resource' }), 'network')
  assertEquals(classifySyncError({ status: 503, message: 'Service Unavailable' }), 'network')
})

Deno.test('classifySyncError: token vencido es auth, no red', () => {
  assertEquals(classifySyncError({ status: 401, message: 'JWT expired' }), 'auth')
  assertEquals(classifySyncError({ code: 'PGRST301', message: 'JWSError' }), 'auth')
})

Deno.test('classifySyncError: el resto es permanente', () => {
  assertEquals(classifySyncError({ code: '22P02', message: 'invalid input syntax for type uuid' }), 'permanent')
  assertEquals(classifySyncError({ status: 400, message: 'bad request' }), 'permanent')
})

Deno.test('blockedByParent: un recordatorio espera a que suba su item', () => {
  const rec: PlannedOp = {
    seq: 2,
    seqs: [2],
    entity: 'recordatorio',
    op: 'insert',
    entityId: 'r1',
    payload: { item_id: 'i1' },
    baseUpdatedAt: null,
    tries: 0,
  }
  assertEquals(blockedByParent(rec, new Set(['i1'])), true)
  assertEquals(blockedByParent(rec, new Set(['otro'])), false)
  assertEquals(blockedByParent({ ...rec, entity: 'item' }, new Set(['i1'])), false)
})

// ============================================================
// Backoff
// ============================================================

Deno.test('backoffDelayMs: crece exponencialmente con techo de 5 min', () => {
  assertEquals(backoffDelayMs(0), 0)
  assertEquals(backoffDelayMs(1), 5_000)
  assertEquals(backoffDelayMs(2), 10_000)
  assertEquals(backoffDelayMs(3), 20_000)
  assertEquals(backoffDelayMs(20), 300_000)
})

// ============================================================
// Presentación del estado (§5)
// ============================================================

Deno.test('formatHaceCuanto: escalas de tiempo', () => {
  const ahora = Date.parse('2026-07-22T12:00:00.000Z')
  const hace = (ms: number) => new Date(ahora - ms).toISOString()

  assertEquals(formatHaceCuanto(hace(10_000), ahora), 'recién')
  assertEquals(formatHaceCuanto(hace(2 * 60_000), ahora), 'hace 2 min')
  assertEquals(formatHaceCuanto(hace(59 * 60_000), ahora), 'hace 59 min')
  assertEquals(formatHaceCuanto(hace(3 * 3_600_000), ahora), 'hace 3 h')
  assertEquals(formatHaceCuanto(hace(24 * 3_600_000), ahora), 'hace 1 día')
  assertEquals(formatHaceCuanto(hace(72 * 3_600_000), ahora), 'hace 3 días')
})

Deno.test('formatHaceCuanto: sin fecha o fecha inválida dice "nunca"', () => {
  const ahora = Date.parse('2026-07-22T12:00:00.000Z')
  assertEquals(formatHaceCuanto(null, ahora), 'nunca')
  assertEquals(formatHaceCuanto('no-es-fecha', ahora), 'nunca')
})

Deno.test('formatHaceCuanto: un reloj adelantado no dice "hace -1 min"', () => {
  const ahora = Date.parse('2026-07-22T12:00:00.000Z')
  assertEquals(formatHaceCuanto(new Date(ahora + 30_000).toISOString(), ahora), 'recién')
})
