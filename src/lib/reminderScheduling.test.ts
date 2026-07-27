// Tests de la lógica pura de scheduling del aviso local de recordatorios.
// Correr con: npx deno test src/lib/reminderScheduling.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import {
  computeDelayMs,
  fechaPospuesta,
  reconcileTimers,
  splitStaleReminders,
} from './reminderScheduling.ts'

const T0 = Date.parse('2026-07-22T12:00:00.000Z')
const en90s = new Date(T0 + 90_000).toISOString()
const en30s = new Date(T0 + 30_000).toISOString()
const hace60s = new Date(T0 - 60_000).toISOString()
const hace3h = new Date(T0 - 3 * 3_600_000).toISOString()
const hace10min = new Date(T0 - 10 * 60_000).toISOString()

// La misma gracia que usa el watcher: vencido hace más de 2 min = catch-up.
const GRACIA = 2 * 60 * 1000

Deno.test('computeDelayMs: futuro devuelve el delta; vencido devuelve 0', () => {
  assertEquals(computeDelayMs(en90s, T0), 90_000)
  assertEquals(computeDelayMs(hace60s, T0), 0)
  assertEquals(computeDelayMs('no-es-fecha', T0), 0)
})

Deno.test('fechaPospuesta: suma minutos a AHORA, no a la fecha vencida original', () => {
  // Un recordatorio que venció hace 3h se pospone desde AHORA (T0), no desde
  // esa fecha vieja: 15 min después de T0, no 15 min después de hace3h.
  assertEquals(fechaPospuesta(15, T0), new Date(T0 + 15 * 60_000).toISOString())
  assertEquals(fechaPospuesta(60, T0), new Date(T0 + 60 * 60_000).toISOString())
})

Deno.test('arma un timer para un pendiente sin timer previo', () => {
  const r = reconcileTimers({
    pending: [{ id: 'a', fecha_hora: en90s }],
    armed: [],
    suppressIds: [],
    now: T0,
  })
  assertEquals(r.toArm, [{ id: 'a', fechaHora: en90s, delayMs: 90_000 }])
  assertEquals(r.toCancel, [])
})

Deno.test('un vencido se arma con delay 0 (dispara de inmediato)', () => {
  const r = reconcileTimers({
    pending: [{ id: 'a', fecha_hora: hace60s }],
    armed: [],
    suppressIds: [],
    now: T0,
  })
  assertEquals(r.toArm, [{ id: 'a', fechaHora: hace60s, delayMs: 0 }])
})

Deno.test('no rearma un pendiente que ya tiene timer con la misma fecha', () => {
  const r = reconcileTimers({
    pending: [{ id: 'a', fecha_hora: en90s }],
    armed: [{ id: 'a', fechaHora: en90s }],
    suppressIds: [],
    now: T0,
  })
  assertEquals(r.toArm, [])
  assertEquals(r.toCancel, [])
})

Deno.test('si cambió la fecha: cancela el viejo y arma el nuevo', () => {
  const r = reconcileTimers({
    pending: [{ id: 'a', fecha_hora: en30s }],
    armed: [{ id: 'a', fechaHora: en90s }],
    suppressIds: [],
    now: T0,
  })
  assertEquals(r.toArm, [{ id: 'a', fechaHora: en30s, delayMs: 30_000 }])
  assertEquals(r.toCancel, ['a'])
})

Deno.test('cancela el timer de un recordatorio que ya no está pendiente', () => {
  // 'a' ya no viene en pending (lo marcaron hecho / se envió): se cancela.
  const r = reconcileTimers({
    pending: [{ id: 'b', fecha_hora: en90s }],
    armed: [{ id: 'a', fechaHora: en30s }],
    suppressIds: [],
    now: T0,
  })
  assertEquals(r.toCancel, ['a'])
  assertEquals(r.toArm, [{ id: 'b', fechaHora: en90s, delayMs: 90_000 }])
})

Deno.test('suppressIds evita rearmar un id ya disparado en esta sesión', () => {
  // 'a' ya disparó (está en suppress) y todavía aparece pendiente porque el
  // espejo local no reflejó 'enviado' aún: no se rearma ni se cancela.
  const r = reconcileTimers({
    pending: [{ id: 'a', fecha_hora: hace60s }],
    armed: [],
    suppressIds: ['a'],
    now: T0,
  })
  assertEquals(r.toArm, [])
  assertEquals(r.toCancel, [])
})

// ============================================================
// splitStaleReminders — catch-up de vencidos viejos (§6.2)
// ============================================================

Deno.test('splitStaleReminders: lo que vence en el futuro es fresh', () => {
  const r = splitStaleReminders({
    pending: [{ id: 'a', fecha_hora: en90s }],
    suppressIds: [],
    now: T0,
    graceMs: GRACIA,
  })
  assertEquals(r.fresh.map((p) => p.id), ['a'])
  assertEquals(r.stale, [])
})

Deno.test('splitStaleReminders: vencido dentro de la gracia sigue siendo fresh', () => {
  // Cayó entre dos sondeos con la app abierta: se avisa normal, con su
  // contenido, no como catch-up.
  const r = splitStaleReminders({
    pending: [{ id: 'a', fecha_hora: hace60s }],
    suppressIds: [],
    now: T0,
    graceMs: GRACIA,
  })
  assertEquals(r.fresh.map((p) => p.id), ['a'])
  assertEquals(r.stale, [])
})

Deno.test('splitStaleReminders: vencido hace rato va a catch-up', () => {
  // La app estuvo cerrada o sin señal cuando venció: no se dispara un aviso con
  // fecha vieja haciéndose pasar por recién vencido.
  const r = splitStaleReminders({
    pending: [
      { id: 'viejo', fecha_hora: hace3h },
      { id: 'tambien-viejo', fecha_hora: hace10min },
      { id: 'proximo', fecha_hora: en30s },
    ],
    suppressIds: [],
    now: T0,
    graceMs: GRACIA,
  })
  assertEquals(r.stale.map((p) => p.id), ['viejo', 'tambien-viejo'])
  assertEquals(r.fresh.map((p) => p.id), ['proximo'])
})

Deno.test('splitStaleReminders: un catch-up ya avisado no se recuenta', () => {
  // Ya entró en el aviso agregado de este sondeo; si el espejo todavía lo
  // muestra pendiente, no vuelve a sumar al conteo del próximo.
  const r = splitStaleReminders({
    pending: [{ id: 'viejo', fecha_hora: hace3h }],
    suppressIds: ['viejo'],
    now: T0,
    graceMs: GRACIA,
  })
  assertEquals(r.stale, [])
  // Pasa a fresh, donde reconcileTimers lo descarta por suppressIds.
  assertEquals(r.fresh.map((p) => p.id), ['viejo'])
})

Deno.test('splitStaleReminders: una fecha ilegible no se toma por vieja', () => {
  const r = splitStaleReminders({
    pending: [{ id: 'raro', fecha_hora: 'no-es-fecha' }],
    suppressIds: [],
    now: T0,
    graceMs: GRACIA,
  })
  assertEquals(r.stale, [])
  assertEquals(r.fresh.map((p) => p.id), ['raro'])
})

Deno.test('los vencidos viejos ya no arman timers individuales', () => {
  // Encadenado como en el watcher: primero split, después reconcile con fresh.
  const pending = [
    { id: 'viejo', fecha_hora: hace3h },
    { id: 'proximo', fecha_hora: en30s },
  ]
  const { fresh, stale } = splitStaleReminders({
    pending,
    suppressIds: [],
    now: T0,
    graceMs: GRACIA,
  })
  const r = reconcileTimers({ pending: fresh, armed: [], suppressIds: [], now: T0 })

  assertEquals(stale.map((p) => p.id), ['viejo'])
  assertEquals(r.toArm, [{ id: 'proximo', fechaHora: en30s, delayMs: 30_000 }])
})
