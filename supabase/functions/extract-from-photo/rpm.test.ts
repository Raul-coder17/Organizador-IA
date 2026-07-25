// Tests de la lógica pura del freno de RPM. Ninguno toca red ni Gemini real:
// son marcas de tiempo simuladas, así se verifica la ventana deslizante sin
// gastar una sola llamada real contra la cuota de la cuenta.
// Correr con: npx deno test supabase/functions/extract-from-photo/rpm.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { decideRpmSlot } from './rpm.ts'

const RPM = 15
const WINDOW = 60_000

Deno.test('sin llamadas previas, siempre permite', () => {
  const r = decideRpmSlot([], RPM, WINDOW, 1_000_000)
  assertEquals(r.allowed, true)
  assertEquals(r.retryAfterSeconds, 0)
})

Deno.test('con menos de RPM llamadas en la ventana, permite', () => {
  const now = 1_000_000
  // 14 llamadas repartidas en los últimos 30s: por debajo del límite de 15.
  const calls = Array.from({ length: 14 }, (_, i) => now - i * 2000)
  const r = decideRpmSlot(calls, RPM, WINDOW, now)
  assertEquals(r.allowed, true)
})

Deno.test('la llamada número 16 dentro de la ventana se bloquea', () => {
  const now = 1_000_000
  // 15 llamadas ya hechas, todas dentro de los últimos 60s.
  const calls = Array.from({ length: 15 }, (_, i) => now - i * 1000)
  const r = decideRpmSlot(calls, RPM, WINDOW, now)
  assertEquals(r.allowed, false)
  assertEquals(r.retryAfterSeconds > 0, true)
})

Deno.test('llamadas fuera de la ventana no cuentan', () => {
  const now = 1_000_000
  // 20 llamadas, pero todas de hace más de 60s: no deberían contar.
  const calls = Array.from({ length: 20 }, (_, i) => now - WINDOW - 1000 - i * 500)
  const r = decideRpmSlot(calls, RPM, WINDOW, now)
  assertEquals(r.allowed, true)
})

Deno.test('mezcla: algunas dentro, algunas fuera de la ventana — solo cuentan las de adentro', () => {
  const now = 1_000_000
  const viejas = Array.from({ length: 10 }, (_, i) => now - WINDOW - 5000 - i * 1000) // fuera
  const nuevas = Array.from({ length: 15 }, (_, i) => now - i * 1000) // adentro, exactamente 15
  const r = decideRpmSlot([...viejas, ...nuevas], RPM, WINDOW, now)
  assertEquals(r.allowed, false) // 15 adentro == maxRpm, la 16a se bloquea
})

Deno.test('retryAfterSeconds coincide con cuándo la más vieja sale de la ventana', () => {
  const now = 1_000_000
  // La más vieja de las 15 tiene 59000ms de antigüedad: sale de la ventana en 1s.
  const calls = Array.from({ length: 15 }, (_, i) => now - i * (59_000 / 14))
  const r = decideRpmSlot(calls, RPM, WINDOW, now)
  assertEquals(r.allowed, false)
  assertEquals(r.retryAfterSeconds, 1)
})

Deno.test('pasado el tiempo suficiente, vuelve a permitir (simulación de "esperar y reintentar")', () => {
  const now = 1_000_000
  const calls = Array.from({ length: 15 }, (_, i) => now - i * 1000) // las 15 más nuevas en los últimos 15s
  const bloqueada = decideRpmSlot(calls, RPM, WINDOW, now)
  assertEquals(bloqueada.allowed, false)

  // Avanzamos el reloj más allá de lo que indicó retryAfterSeconds.
  const masTarde = now + bloqueada.retryAfterSeconds * 1000 + 1000
  const permitida = decideRpmSlot(calls, RPM, WINDOW, masTarde)
  assertEquals(permitida.allowed, true)
})

Deno.test('maxRpm distinto de 15 también funciona (no hardcodea el número)', () => {
  const now = 1_000_000
  const calls = Array.from({ length: 3 }, (_, i) => now - i * 1000)
  assertEquals(decideRpmSlot(calls, 3, WINDOW, now).allowed, false)
  assertEquals(decideRpmSlot(calls, 4, WINDOW, now).allowed, true)
})
