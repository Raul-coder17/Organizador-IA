// Tests del cálculo de recurrencia del lado Edge + PARIDAD con el gemelo del
// cliente.
// Correr con: npx deno test supabase/functions/send-reminder-notifications/recurrencia.test.ts
//
// La parte que importa de verdad es la de abajo: este test importa los DOS
// módulos (el del Edge y el de src/lib) y compara sus salidas sobre un barrido
// de fechas. Es lo que impide que las dos copias se separen con el tiempo — si
// alguien toca una sola, esto falla.
import { assertEquals } from 'jsr:@std/assert@1'
import {
  avanzarUnaVuelta,
  parseDiasSemana,
  parseRecurrencia,
  proximaOcurrencia,
  type Recurrencia,
} from './recurrencia.ts'
import {
  avanzarUnaVuelta as avanzarCliente,
  parseDiasSemana as parseDiasCliente,
  proximaOcurrencia as proximaCliente,
} from '../../../src/lib/recurrencia.ts'

// Los tres tipos que no llevan días. `dias_semana` se barre aparte, contra
// todas las combinaciones de días.
const RECURRENCIAS: Recurrencia[] = ['diario', 'semanal', 'mensual']

// Las 127 combinaciones no vacías de días de la semana.
const TODAS_LAS_COMBINACIONES: number[][] = Array.from({ length: 127 }, (_, i) => {
  const mascara = i + 1
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => mascara & (1 << d))
})

// ============================================================
// Comportamiento propio (los mismos casos borde que el cliente)
// ============================================================

Deno.test('[edge] diario/semanal: suma fija conservando la hora', () => {
  assertEquals(avanzarUnaVuelta('2026-07-25T09:00:00.000Z', 'diario'), '2026-07-26T09:00:00.000Z')
  assertEquals(avanzarUnaVuelta('2026-07-25T09:00:00.000Z', 'semanal'), '2026-08-01T09:00:00.000Z')
  assertEquals(avanzarUnaVuelta('2026-12-31T23:30:00.000Z', 'diario'), '2027-01-01T23:30:00.000Z')
})

Deno.test('[edge] mensual: recorta el 31 al último día del mes destino', () => {
  assertEquals(avanzarUnaVuelta('2026-01-31T09:00:00.000Z', 'mensual'), '2026-02-28T09:00:00.000Z')
  assertEquals(avanzarUnaVuelta('2028-01-31T09:00:00.000Z', 'mensual'), '2028-02-29T09:00:00.000Z')
  assertEquals(avanzarUnaVuelta('2026-03-31T09:00:00.000Z', 'mensual'), '2026-04-30T09:00:00.000Z')
  assertEquals(avanzarUnaVuelta('2100-01-31T09:00:00.000Z', 'mensual'), '2100-02-28T09:00:00.000Z')
  assertEquals(avanzarUnaVuelta('2026-12-31T09:00:00.000Z', 'mensual'), '2027-01-31T09:00:00.000Z')
})

Deno.test('[edge] proximaOcurrencia: un atrasado reengancha en su próxima vuelta real', () => {
  const ahora = Date.parse('2026-07-25T12:00:00.000Z')
  assertEquals(proximaOcurrencia('2026-07-20T09:00:00.000Z', 'diario', ahora), '2026-07-26T09:00:00.000Z')
  assertEquals(proximaOcurrencia('2026-07-01T09:00:00.000Z', 'semanal', ahora), '2026-07-29T09:00:00.000Z')
  assertEquals(proximaOcurrencia('2026-01-31T09:00:00.000Z', 'mensual', ahora), '2026-07-28T09:00:00.000Z')
})

Deno.test('[edge] parseRecurrencia: solo los cuatro valores válidos', () => {
  assertEquals(parseRecurrencia('mensual'), 'mensual')
  assertEquals(parseRecurrencia('dias_semana'), 'dias_semana')
  assertEquals(parseRecurrencia(null), null)
  assertEquals(parseRecurrencia('anual'), null)
})

Deno.test('[edge] dias_semana: salta al próximo día marcado', () => {
  // 2026-07-27 es lunes; L/M/V = [1,3,5].
  assertEquals(
    avanzarUnaVuelta('2026-07-27T09:00:00.000Z', 'dias_semana', [1, 3, 5]),
    '2026-07-29T09:00:00.000Z',
  )
  // Viernes → lunes, cruzando el fin de semana.
  assertEquals(
    avanzarUnaVuelta('2026-07-31T09:00:00.000Z', 'dias_semana', [1, 3, 5]),
    '2026-08-03T09:00:00.000Z',
  )
})

Deno.test('[edge] dias_semana: sin días no avanza (y no cuelga el catch-up)', () => {
  const ahora = Date.parse('2027-01-01T00:00:00.000Z')
  assertEquals(avanzarUnaVuelta('2026-07-27T09:00:00.000Z', 'dias_semana', []), '2026-07-27T09:00:00.000Z')
  assertEquals(
    proximaOcurrencia('2026-07-27T09:00:00.000Z', 'dias_semana', ahora, null),
    '2026-07-27T09:00:00.000Z',
  )
})

Deno.test('[edge] una fecha ilegible se devuelve tal cual', () => {
  assertEquals(avanzarUnaVuelta('no-es-fecha', 'diario'), 'no-es-fecha')
})

// ============================================================
// PARIDAD cliente ↔ Edge
// ============================================================
//
// El mismo recordatorio puede avanzar por el cliente (aviso local o "marcar
// hecho") o por este cron. Si las dos implementaciones no coincidieran, la
// fecha de la próxima vuelta dependería de quién lo movió primero — un bug
// imposible de reproducir a mano. Por eso se comparan acá, exhaustivamente.

// Semillas elegidas para tocar todos los casos raros: finales de mes de todos
// los largos (28/29/30/31), febrero bisiesto y no bisiesto, la regla del siglo
// (2100 no, 2000 sí), cruce de año, y horas con segundos/milisegundos.
const SEMILLAS = [
  '2026-01-01T00:00:00.000Z',
  '2026-01-29T09:00:00.000Z',
  '2026-01-30T09:00:00.000Z',
  '2026-01-31T09:00:00.000Z',
  '2026-02-28T23:59:59.999Z',
  '2026-03-31T12:00:00.000Z',
  '2026-04-30T06:15:00.000Z',
  '2026-05-31T23:45:30.500Z',
  '2026-06-30T00:00:01.000Z',
  '2026-07-25T09:00:00.000Z',
  '2026-08-31T18:30:00.000Z',
  '2026-09-30T21:00:00.000Z',
  '2026-10-31T03:00:00.000Z',
  '2026-11-30T15:00:00.000Z',
  '2026-12-31T23:30:00.000Z',
  '2028-01-31T09:00:00.000Z', // bisiesto
  '2028-02-29T09:00:00.000Z', // 29 de febrero como base
  '2100-01-31T09:00:00.000Z', // no bisiesto (siglo)
  '2000-01-31T09:00:00.000Z', // bisiesto (divisible por 400)
]

Deno.test('paridad: avanzarUnaVuelta da lo mismo en el cliente y en el Edge', () => {
  for (const semilla of SEMILLAS) {
    for (const r of RECURRENCIAS) {
      // 30 vueltas encadenadas: así se comparan también las fechas derivadas
      // (que es donde el recorte mensual podría separar a las dos copias).
      let edge = semilla
      let cliente = semilla
      for (let i = 0; i < 30; i++) {
        edge = avanzarUnaVuelta(edge, r)
        cliente = avanzarCliente(cliente, r)
        assertEquals(edge, cliente, `divergen en ${semilla} (${r}), vuelta ${i + 1}`)
      }
    }
  }
})

Deno.test('paridad: proximaOcurrencia da lo mismo en el cliente y en el Edge', () => {
  const ahoras = [
    Date.parse('2026-07-25T12:00:00.000Z'),
    Date.parse('2026-02-28T23:59:59.999Z'),
    Date.parse('2027-01-01T00:00:00.000Z'),
    Date.parse('2029-03-01T05:00:00.000Z'),
  ]
  for (const semilla of SEMILLAS) {
    for (const r of RECURRENCIAS) {
      for (const ahora of ahoras) {
        assertEquals(
          proximaOcurrencia(semilla, r, ahora),
          proximaCliente(semilla, r, ahora),
          `divergen en ${semilla} (${r}) con ahora=${new Date(ahora).toISOString()}`,
        )
      }
    }
  }
})

Deno.test('paridad: barrido de 400 días consecutivos para las tres recurrencias', () => {
  const inicio = Date.parse('2026-01-01T09:00:00.000Z')
  const ahora = Date.parse('2026-07-25T12:00:00.000Z')
  for (let dia = 0; dia < 400; dia++) {
    const iso = new Date(inicio + dia * 24 * 60 * 60 * 1000).toISOString()
    for (const r of RECURRENCIAS) {
      assertEquals(avanzarUnaVuelta(iso, r), avanzarCliente(iso, r), `avanzar ${iso} (${r})`)
      assertEquals(
        proximaOcurrencia(iso, r, ahora),
        proximaCliente(iso, r, ahora),
        `proxima ${iso} (${r})`,
      )
    }
  }
})

// ---------------------------------------------------------------------------
// Paridad de dias_semana
// ---------------------------------------------------------------------------
//
// Este tipo tiene un parámetro más (los días), así que el barrido va por las
// 127 combinaciones posibles. Es donde más fácil se separarían las dos copias:
// un off-by-one en el rango de saltos, o un orden de días distinto, pasaría
// desapercibido en los tests de comportamiento de cada lado pero no acá.

Deno.test('paridad: parseDiasSemana normaliza igual en los dos lados', () => {
  const entradas: unknown[] = [
    [1, 3, 5], [5, 3, 1], [0], [0, 6], [1, 1, 1], [1, 7, -1, 2],
    [1.5, 2], ['3'], ['lunes'], [], null, undefined, '1,3,5', [9, 10],
    [0, 1, 2, 3, 4, 5, 6],
  ]
  for (const e of entradas) {
    assertEquals(parseDiasSemana(e), parseDiasCliente(e), `divergen normalizando ${JSON.stringify(e)}`)
  }
})

Deno.test('paridad: dias_semana, las 127 combinaciones desde cada día de la semana', () => {
  // Una semana completa de fechas base (2026-07-27 es lunes) por cada
  // combinación de días: 127 × 7 = 889 escenarios, con 8 vueltas encadenadas
  // cada uno.
  const semana = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse('2026-07-27T09:00:00.000Z') + i * 86_400_000).toISOString(),
  )
  for (const dias of TODAS_LAS_COMBINACIONES) {
    for (const base of semana) {
      let edge = base
      let cliente = base
      for (let vuelta = 0; vuelta < 8; vuelta++) {
        edge = avanzarUnaVuelta(edge, 'dias_semana', dias)
        cliente = avanzarCliente(cliente, 'dias_semana', dias)
        assertEquals(edge, cliente, `divergen [${dias}] desde ${base}, vuelta ${vuelta + 1}`)
      }
    }
  }
})

Deno.test('paridad: dias_semana con atrasos (proximaOcurrencia) y días degenerados', () => {
  const ahora = Date.parse('2026-07-30T12:00:00.000Z')
  const semana = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.parse('2026-07-27T09:00:00.000Z') + i * 86_400_000).toISOString(),
  )
  // Se incluyen a propósito los sets vacíos/inválidos: los dos lados tienen que
  // coincidir también en NO avanzar.
  const casos: (number[] | null)[] = [...TODAS_LAS_COMBINACIONES, [], null, [9, -3]]
  for (const dias of casos) {
    for (const base of semana) {
      for (const atraso of [0, 10, 90]) {
        const iso = new Date(new Date(base).getTime() - atraso * 86_400_000).toISOString()
        assertEquals(
          proximaOcurrencia(iso, 'dias_semana', ahora, dias),
          proximaCliente(iso, 'dias_semana', ahora, dias),
          `divergen [${dias}] desde ${iso}`,
        )
      }
    }
  }
})
