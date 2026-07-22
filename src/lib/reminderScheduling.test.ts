// Tests de la lógica pura de scheduling del aviso local de recordatorios.
// Correr con: npx deno test src/lib/reminderScheduling.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { computeDelayMs, reconcileTimers } from './reminderScheduling.ts'

const T0 = Date.parse('2026-07-22T12:00:00.000Z')
const en90s = new Date(T0 + 90_000).toISOString()
const en30s = new Date(T0 + 30_000).toISOString()
const hace60s = new Date(T0 - 60_000).toISOString()

Deno.test('computeDelayMs: futuro devuelve el delta; vencido devuelve 0', () => {
  assertEquals(computeDelayMs(en90s, T0), 90_000)
  assertEquals(computeDelayMs(hace60s, T0), 0)
  assertEquals(computeDelayMs('no-es-fecha', T0), 0)
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
  // 'a' ya disparó (está en suppress) y todavía aparece pendiente porque la DB
  // no reflejó 'enviado' aún: no se rearma ni se cancela (no tiene timer).
  const r = reconcileTimers({
    pending: [{ id: 'a', fecha_hora: hace60s }],
    armed: [],
    suppressIds: ['a'],
    now: T0,
  })
  assertEquals(r.toArm, [])
  assertEquals(r.toCancel, [])
})
