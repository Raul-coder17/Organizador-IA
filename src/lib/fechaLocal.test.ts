// Tests del cálculo de la fecha ancla a partir de una hora sola, que es lo que
// usan las recurrencias que no piden fecha ("Diario" y "Días específicos") tanto
// en el form manual como en las dos propuestas de la IA.
// Correr con: npx deno test src/lib/fechaLocal.test.ts
//
// Todo se hace en hora LOCAL del proceso a propósito: es exactamente lo que hace
// el navegador del usuario. Los casos de abajo no dependen de qué zona sea,
// porque construyen el "ahora" con el constructor local y comparan contra
// campos locales.
import { assertEquals } from 'jsr:@std/assert@1'
import { horaDeDatetimeLocal, proximaFechaConHora, recurrenciaSinFecha } from './fechaLocal.ts'
import { parseDiasSemana, prepararRecurrencia } from './recurrencia.ts'

// 2026-07-27 es LUNES. Las 12:00 dejan margen para probar "antes" y "después".
const LUNES_MEDIODIA = new Date(2026, 6, 27, 12, 0, 0, 0)

Deno.test('la referencia de los tests cae en lunes', () => {
  assertEquals(LUNES_MEDIODIA.getDay(), 1)
})

Deno.test('una hora que todavía no pasó queda HOY', () => {
  assertEquals(proximaFechaConHora('18:30', LUNES_MEDIODIA), '2026-07-27T18:30')
})

Deno.test('una hora que ya pasó se va a MAÑANA', () => {
  assertEquals(proximaFechaConHora('07:00', LUNES_MEDIODIA), '2026-07-28T07:00')
})

Deno.test('la hora exacta de ahora se va a mañana, no vence al instante', () => {
  assertEquals(proximaFechaConHora('12:00', LUNES_MEDIODIA), '2026-07-28T12:00')
})

Deno.test('cruzar la medianoche corre también el mes', () => {
  const finDeMes = new Date(2026, 6, 31, 23, 30, 0, 0)
  assertEquals(proximaFechaConHora('08:00', finDeMes), '2026-08-01T08:00')
})

Deno.test('acepta la hora sin cero a la izquierda y la normaliza', () => {
  assertEquals(proximaFechaConHora('7:05', LUNES_MEDIODIA), '2026-07-28T07:05')
})

Deno.test('una hora ilegible devuelve null, no una fecha inventada', () => {
  for (const basura of ['', 'las siete', '7', '25:00', '12:60', '12-30']) {
    assertEquals(proximaFechaConHora(basura, LUNES_MEDIODIA), null, `con "${basura}"`)
  }
})

// --- El ancla nunca queda en el pasado --------------------------------------
//
// Es la garantía que sostiene todo: el usuario elige una hora sin ver ninguna
// fecha, así que si el cálculo pudiera dar algo vencido, el recordatorio
// sonaría al instante sin que nadie lo haya pedido.

Deno.test('con "diario", el ancla siempre es futura, a cualquier hora del día', () => {
  for (let h = 0; h < 24; h++) {
    for (const min of [0, 30, 59]) {
      const ahora = new Date(2026, 6, 27, h, min, 0, 0)
      for (const hora of ['00:00', '07:00', '12:00', '18:30', '23:59']) {
        const ancla = proximaFechaConHora(hora, ahora)!
        assertEquals(
          new Date(ancla).getTime() > ahora.getTime(),
          true,
          `hora ${hora} con ahora ${ahora.toISOString()}`,
        )
      }
    }
  }
})

Deno.test('con "días específicos", la primera vuelta es futura Y cae en un día marcado', () => {
  const L_M_V = [1, 3, 5]
  // Un ahora por cada día de la semana, y por cada uno una hora ya pasada y una
  // que falta: son los dos caminos de `proximaFechaConHora`.
  for (let dia = 0; dia < 7; dia++) {
    for (const horaAhora of [6, 12, 22]) {
      const ahora = new Date(2026, 6, 26 + dia, horaAhora, 0, 0, 0)
      const ancla = proximaFechaConHora('07:00', ahora)!
      const listo = prepararRecurrencia(new Date(ancla).toISOString(), 'dias_semana', L_M_V)

      assertEquals(listo.recurrencia, 'dias_semana')
      assertEquals(
        new Date(listo.fechaIso).getTime() > ahora.getTime(),
        true,
        `quedó en el pasado con ahora=${ahora.toISOString()}`,
      )
      // El invariante del módulo: el día de la fecha guardada está entre los
      // días guardados (los dos en escala UTC).
      assertEquals(
        (listo.diasUtc ?? []).includes(new Date(listo.fechaIso).getUTCDay()),
        true,
        `cayó en un día no marcado con ahora=${ahora.toISOString()}`,
      )
      assertEquals(parseDiasSemana(listo.diasUtc)?.length, 3)
    }
  }
})

// --- Helpers de apoyo del form ----------------------------------------------

Deno.test('recurrenciaSinFecha marca sólo diario y dias_semana', () => {
  assertEquals(recurrenciaSinFecha('diario'), true)
  assertEquals(recurrenciaSinFecha('dias_semana'), true)
  assertEquals(recurrenciaSinFecha('semanal'), false)
  assertEquals(recurrenciaSinFecha('mensual'), false)
  assertEquals(recurrenciaSinFecha(''), false)
  assertEquals(recurrenciaSinFecha(null), false)
  assertEquals(recurrenciaSinFecha(undefined), false)
})

Deno.test('horaDeDatetimeLocal saca la hora de un datetime-local y nada más', () => {
  assertEquals(horaDeDatetimeLocal('2026-07-27T07:00'), '07:00')
  assertEquals(horaDeDatetimeLocal('2026-07-27T23:45:30'), '23:45')
  assertEquals(horaDeDatetimeLocal(''), '')
  assertEquals(horaDeDatetimeLocal('07:00'), '')
})
