// Tests del cálculo de "próxima ocurrencia" de un recordatorio recurrente.
// Correr con: npx deno test src/lib/recurrencia.test.ts
//
// La paridad con el gemelo del Edge (send-reminder-notifications/recurrencia.ts)
// se verifica aparte, en el test de ese lado: importa los DOS módulos y compara
// sus salidas sobre un barrido de fechas.
import { assertEquals } from 'jsr:@std/assert@1'
import {
  ajustarADiaMarcado,
  avanzarUnaVuelta,
  corrimientoDiaUtc,
  diasLocalesAUtc,
  diasUtcALocales,
  etiquetaDias,
  parseDiasSemana,
  parseRecurrencia,
  proximaOcurrencia,
} from './recurrencia.ts'

// Referencias de días de la semana usadas abajo (todo en UTC, como el módulo).
// 2026-07-27 es LUNES. De ahí salen el resto.
const LUN = '2026-07-27T09:00:00.000Z'
const MAR = '2026-07-28T09:00:00.000Z'
const MIE = '2026-07-29T09:00:00.000Z'
const JUE = '2026-07-30T09:00:00.000Z'
const VIE = '2026-07-31T09:00:00.000Z'
const SAB = '2026-08-01T09:00:00.000Z'
const DOM = '2026-08-02T09:00:00.000Z'

const L_M_V = [1, 3, 5] // lunes, miércoles, viernes
const SOLO_MAR = [2]
const TODOS = [0, 1, 2, 3, 4, 5, 6]

Deno.test('las constantes de referencia caen en el día que dicen', () => {
  // Si esto falla, todos los tests de días de abajo están mintiendo.
  assertEquals(new Date(LUN).getUTCDay(), 1)
  assertEquals(new Date(MAR).getUTCDay(), 2)
  assertEquals(new Date(MIE).getUTCDay(), 3)
  assertEquals(new Date(JUE).getUTCDay(), 4)
  assertEquals(new Date(VIE).getUTCDay(), 5)
  assertEquals(new Date(SAB).getUTCDay(), 6)
  assertEquals(new Date(DOM).getUTCDay(), 0)
})

// ============================================================
// parseRecurrencia — lo que viene de la base / de la IA
// ============================================================

Deno.test('parseRecurrencia: acepta los tres valores válidos', () => {
  assertEquals(parseRecurrencia('diario'), 'diario')
  assertEquals(parseRecurrencia('semanal'), 'semanal')
  assertEquals(parseRecurrencia('mensual'), 'mensual')
})

Deno.test('parseRecurrencia: acepta dias_semana', () => {
  assertEquals(parseRecurrencia('dias_semana'), 'dias_semana')
})

Deno.test('parseRecurrencia: cualquier otra cosa es "no se repite"', () => {
  // Una recurrencia inventada tiene que degradar a recordatorio de una sola
  // vez, no romper el cálculo ni propagarse a la base.
  assertEquals(parseRecurrencia(null), null)
  assertEquals(parseRecurrencia(undefined), null)
  assertEquals(parseRecurrencia(''), null)
  assertEquals(parseRecurrencia('anual'), null)
  assertEquals(parseRecurrencia('DIARIO'), null)
  assertEquals(parseRecurrencia(7), null)
})

// ============================================================
// avanzarUnaVuelta — diario
// ============================================================

Deno.test('diario: suma un día conservando la hora', () => {
  assertEquals(
    avanzarUnaVuelta('2026-07-25T09:00:00.000Z', 'diario'),
    '2026-07-26T09:00:00.000Z',
  )
})

Deno.test('diario: cruza el fin de mes', () => {
  assertEquals(
    avanzarUnaVuelta('2026-01-31T09:00:00.000Z', 'diario'),
    '2026-02-01T09:00:00.000Z',
  )
})

Deno.test('diario: cruza el fin de año', () => {
  assertEquals(
    avanzarUnaVuelta('2026-12-31T23:30:00.000Z', 'diario'),
    '2027-01-01T23:30:00.000Z',
  )
})

Deno.test('diario: 28 de febrero de un año bisiesto pasa por el 29', () => {
  assertEquals(
    avanzarUnaVuelta('2028-02-28T09:00:00.000Z', 'diario'),
    '2028-02-29T09:00:00.000Z',
  )
  assertEquals(
    avanzarUnaVuelta('2028-02-29T09:00:00.000Z', 'diario'),
    '2028-03-01T09:00:00.000Z',
  )
})

// ============================================================
// avanzarUnaVuelta — semanal
// ============================================================

Deno.test('semanal: suma 7 días y cae en el mismo día de la semana', () => {
  const base = '2026-07-25T09:00:00.000Z' // sábado
  const siguiente = avanzarUnaVuelta(base, 'semanal')
  assertEquals(siguiente, '2026-08-01T09:00:00.000Z')
  assertEquals(new Date(siguiente).getUTCDay(), new Date(base).getUTCDay())
})

Deno.test('semanal: cruza el fin de mes y el fin de año', () => {
  assertEquals(
    avanzarUnaVuelta('2026-01-31T12:00:00.000Z', 'semanal'),
    '2026-02-07T12:00:00.000Z',
  )
  assertEquals(
    avanzarUnaVuelta('2026-12-28T12:00:00.000Z', 'semanal'),
    '2027-01-04T12:00:00.000Z',
  )
})

// ============================================================
// avanzarUnaVuelta — mensual (los casos borde que importan)
// ============================================================

Deno.test('mensual: caso normal, mismo día del mes siguiente', () => {
  assertEquals(
    avanzarUnaVuelta('2026-07-15T09:00:00.000Z', 'mensual'),
    '2026-08-15T09:00:00.000Z',
  )
})

Deno.test('mensual: 31 de enero se recorta al 28 de febrero (año no bisiesto)', () => {
  assertEquals(
    avanzarUnaVuelta('2026-01-31T09:00:00.000Z', 'mensual'),
    '2026-02-28T09:00:00.000Z',
  )
})

Deno.test('mensual: 31 de enero cae en el 29 de febrero si el año es bisiesto', () => {
  assertEquals(
    avanzarUnaVuelta('2028-01-31T09:00:00.000Z', 'mensual'),
    '2028-02-29T09:00:00.000Z',
  )
})

Deno.test('mensual: el 30 de enero también se recorta a febrero', () => {
  assertEquals(
    avanzarUnaVuelta('2026-01-30T09:00:00.000Z', 'mensual'),
    '2026-02-28T09:00:00.000Z',
  )
})

Deno.test('mensual: 31 de marzo se recorta al 30 de abril', () => {
  assertEquals(
    avanzarUnaVuelta('2026-03-31T09:00:00.000Z', 'mensual'),
    '2026-04-30T09:00:00.000Z',
  )
})

Deno.test('mensual: 31 de mayo se recorta al 30 de junio', () => {
  assertEquals(
    avanzarUnaVuelta('2026-05-31T09:00:00.000Z', 'mensual'),
    '2026-06-30T09:00:00.000Z',
  )
})

Deno.test('mensual: 31 de diciembre cruza al 31 de enero del año siguiente', () => {
  assertEquals(
    avanzarUnaVuelta('2026-12-31T09:00:00.000Z', 'mensual'),
    '2027-01-31T09:00:00.000Z',
  )
})

Deno.test('mensual: diciembre → enero conserva el año nuevo también en día normal', () => {
  assertEquals(
    avanzarUnaVuelta('2026-12-15T09:00:00.000Z', 'mensual'),
    '2027-01-15T09:00:00.000Z',
  )
})

Deno.test('mensual: 2100 no es bisiesto (regla del siglo)', () => {
  // 2100 es divisible por 4 pero también por 100 y no por 400: NO es bisiesto.
  // Es el caso que delata una implementación que asume "divisible por 4".
  assertEquals(
    avanzarUnaVuelta('2100-01-31T09:00:00.000Z', 'mensual'),
    '2100-02-28T09:00:00.000Z',
  )
})

Deno.test('mensual: 2000 sí es bisiesto (divisible por 400)', () => {
  assertEquals(
    avanzarUnaVuelta('2000-01-31T09:00:00.000Z', 'mensual'),
    '2000-02-29T09:00:00.000Z',
  )
})

Deno.test('mensual: el recorte NO se recuerda — un 31 que pasó por febrero queda en 28', () => {
  // Consecuencia conocida y documentada del diseño sin columna de "día ancla":
  // una vez recortada, la fecha nueva es la base de la vuelta siguiente.
  const feb = avanzarUnaVuelta('2026-01-31T09:00:00.000Z', 'mensual')
  assertEquals(feb, '2026-02-28T09:00:00.000Z')
  assertEquals(avanzarUnaVuelta(feb, 'mensual'), '2026-03-28T09:00:00.000Z')
})

Deno.test('mensual: conserva hora, minutos, segundos y milisegundos', () => {
  assertEquals(
    avanzarUnaVuelta('2026-01-31T23:45:30.500Z', 'mensual'),
    '2026-02-28T23:45:30.500Z',
  )
})

// ============================================================
// Fechas ilegibles
// ============================================================

Deno.test('una fecha ilegible se devuelve tal cual, sin "Invalid Date"', () => {
  // Mejor dejar el recordatorio como estaba que pisarlo con basura.
  for (const r of ['diario', 'semanal', 'mensual'] as const) {
    assertEquals(avanzarUnaVuelta('no-es-fecha', r), 'no-es-fecha')
    assertEquals(proximaOcurrencia('no-es-fecha', r, Date.parse('2026-07-25T12:00:00Z')), 'no-es-fecha')
  }
})

// ============================================================
// proximaOcurrencia — el catch-up de los atrasados
// ============================================================

const AHORA = Date.parse('2026-07-25T12:00:00.000Z')

Deno.test('proximaOcurrencia: marcado a horario, avanza una sola vuelta', () => {
  assertEquals(
    proximaOcurrencia('2026-07-25T09:00:00.000Z', 'diario', AHORA),
    '2026-07-26T09:00:00.000Z',
  )
})

Deno.test('proximaOcurrencia: un diario atrasado 5 días reengancha en la próxima vuelta real', () => {
  // Sin el catch-up, sumar un día lo dejaría en 2026-07-21: seguiría vencido y
  // volvería a dispararse en el ciclo siguiente, una vez por día de atraso.
  assertEquals(
    proximaOcurrencia('2026-07-20T09:00:00.000Z', 'diario', AHORA),
    '2026-07-26T09:00:00.000Z',
  )
})

Deno.test('proximaOcurrencia: un semanal atrasado salta las vueltas perdidas', () => {
  assertEquals(
    proximaOcurrencia('2026-07-01T09:00:00.000Z', 'semanal', AHORA),
    '2026-07-29T09:00:00.000Z',
  )
})

Deno.test('proximaOcurrencia: un mensual atrasado arrastra el recorte de febrero', () => {
  // 31/01 → 28/02 → 28/03 → 28/04 → 28/05 → 28/06 → 28/07 (la primera > ahora).
  assertEquals(
    proximaOcurrencia('2026-01-31T09:00:00.000Z', 'mensual', AHORA),
    '2026-07-28T09:00:00.000Z',
  )
})

Deno.test('proximaOcurrencia: siempre es ESTRICTAMENTE posterior a ahora', () => {
  // Empate exacto: la vuelta calculada cae justo en el ahora. Tiene que
  // avanzar otra, si no quedaría vencida en el mismo instante en que se guarda.
  const ahora = Date.parse('2026-07-25T09:00:00.000Z')
  assertEquals(
    proximaOcurrencia('2026-07-24T09:00:00.000Z', 'diario', ahora),
    '2026-07-26T09:00:00.000Z',
  )
})

Deno.test('proximaOcurrencia: marcar hecho ANTES de la fecha avanza desde la fecha, no desde hoy', () => {
  // El usuario se toma la pastilla de mañana hoy: la próxima sigue siendo la
  // del día siguiente al programado, no "mañana desde hoy". El ancla es la
  // fecha del recordatorio, no el reloj.
  assertEquals(
    proximaOcurrencia('2026-07-30T09:00:00.000Z', 'diario', AHORA),
    '2026-07-31T09:00:00.000Z',
  )
})

// ============================================================
// parseDiasSemana — lo que llega de la base / del outbox / de la IA
// ============================================================

Deno.test('parseDiasSemana: normaliza, deduplica y ordena de lunes a domingo', () => {
  assertEquals(parseDiasSemana([5, 1, 3]), [1, 3, 5])
  assertEquals(parseDiasSemana([1, 1, 1]), [1])
  // El domingo (0) va ÚLTIMO, no primero: el orden es de presentación, no
  // numérico.
  assertEquals(parseDiasSemana([0, 1]), [1, 0])
  assertEquals(parseDiasSemana([0, 6, 3]), [3, 6, 0])
})

Deno.test('parseDiasSemana: descarta valores fuera de rango y basura', () => {
  assertEquals(parseDiasSemana([1, 7, -1, 2]), [1, 2])
  assertEquals(parseDiasSemana([1.5, 2]), [2])
  assertEquals(parseDiasSemana(['3']), [3]) // texto numérico de un jsonb/array
  assertEquals(parseDiasSemana(['lunes']), null)
})

Deno.test('parseDiasSemana: sin días utilizables devuelve null', () => {
  // null (y no []) porque "cero días" no es una recurrencia calculable: los
  // llamadores lo tratan como "no se puede repetir".
  assertEquals(parseDiasSemana([]), null)
  assertEquals(parseDiasSemana([9, 10]), null)
  assertEquals(parseDiasSemana(null), null)
  assertEquals(parseDiasSemana('1,3,5'), null)
})

Deno.test('etiquetaDias: arma la marca visible en orden de semana', () => {
  assertEquals(etiquetaDias([1, 3, 5]), 'Lun, Mié, Vie')
  assertEquals(etiquetaDias([5, 3, 1]), 'Lun, Mié, Vie')
  assertEquals(etiquetaDias([0, 6]), 'Sáb, Dom')
  assertEquals(etiquetaDias([2]), 'Mar')
})

// ============================================================
// avanzarUnaVuelta — dias_semana
// ============================================================

Deno.test('dias_semana: de lunes con L/M/V va al miércoles', () => {
  assertEquals(avanzarUnaVuelta(LUN, 'dias_semana', L_M_V), MIE)
})

Deno.test('dias_semana: de miércoles con L/M/V va al viernes', () => {
  assertEquals(avanzarUnaVuelta(MIE, 'dias_semana', L_M_V), VIE)
})

Deno.test('dias_semana: de viernes con L/M/V cruza el fin de semana al lunes', () => {
  // El salto más largo del set: 3 días, y cambia de semana.
  assertEquals(avanzarUnaVuelta(VIE, 'dias_semana', L_M_V), '2026-08-03T09:00:00.000Z')
  assertEquals(new Date('2026-08-03T09:00:00.000Z').getUTCDay(), 1)
})

Deno.test('dias_semana: parado en un día NO marcado, salta al próximo marcado', () => {
  // Martes con L/M/V: el siguiente marcado es el miércoles, un solo día después.
  assertEquals(avanzarUnaVuelta(MAR, 'dias_semana', L_M_V), MIE)
  // Jueves con L/M/V: viernes.
  assertEquals(avanzarUnaVuelta(JUE, 'dias_semana', L_M_V), VIE)
})

Deno.test('dias_semana: NUNCA se queda en el mismo día aunque hoy esté marcado', () => {
  // Es la diferencia con ajustarADiaMarcado. Si avanzarUnaVuelta pudiera
  // devolver 0 saltos, un lunes marcado se clavaría en ese lunes para siempre.
  const siguiente = avanzarUnaVuelta(LUN, 'dias_semana', L_M_V)
  assertEquals(siguiente !== LUN, true)
  assertEquals(new Date(siguiente).getTime() > new Date(LUN).getTime(), true)
})

Deno.test('dias_semana: un solo día marcado se comporta EXACTAMENTE como semanal', () => {
  // La continuidad que pide que no haya combinaciones raras: 1 día = 7 saltos.
  let porDias = MAR
  let porSemanal = MAR
  for (let i = 0; i < 10; i++) {
    porDias = avanzarUnaVuelta(porDias, 'dias_semana', SOLO_MAR)
    porSemanal = avanzarUnaVuelta(porSemanal, 'semanal')
    assertEquals(porDias, porSemanal, `divergen en la vuelta ${i + 1}`)
  }
})

Deno.test('dias_semana: los siete días marcados se comportan como diario', () => {
  let porDias = LUN
  let porDiario = LUN
  for (let i = 0; i < 10; i++) {
    porDias = avanzarUnaVuelta(porDias, 'dias_semana', TODOS)
    porDiario = avanzarUnaVuelta(porDiario, 'diario')
    assertEquals(porDias, porDiario, `divergen en la vuelta ${i + 1}`)
  }
})

Deno.test('dias_semana: conserva la hora exacta al saltar de día', () => {
  const conMs = '2026-07-27T23:45:30.500Z' // lunes
  const siguiente = avanzarUnaVuelta(conMs, 'dias_semana', L_M_V)
  assertEquals(siguiente, '2026-07-29T23:45:30.500Z')
})

Deno.test('dias_semana: cruza fin de mes y fin de año sin despeinarse', () => {
  // Viernes 2026-12-25 con L/M/V → lunes 2026-12-28.
  assertEquals(
    avanzarUnaVuelta('2026-12-25T09:00:00.000Z', 'dias_semana', L_M_V),
    '2026-12-28T09:00:00.000Z',
  )
  // Miércoles 2026-12-30 con L/M/V → viernes 2027-01-01 (cambia de año).
  assertEquals(
    avanzarUnaVuelta('2026-12-30T09:00:00.000Z', 'dias_semana', L_M_V),
    '2027-01-01T09:00:00.000Z',
  )
})

Deno.test('dias_semana: sin días utilizables devuelve la fecha intacta', () => {
  // No se inventa un avance: quien llama detecta que no se movió y trata el
  // recordatorio como no recurrente en vez de dejarlo en un bucle.
  assertEquals(avanzarUnaVuelta(LUN, 'dias_semana', []), LUN)
  assertEquals(avanzarUnaVuelta(LUN, 'dias_semana', null), LUN)
  assertEquals(avanzarUnaVuelta(LUN, 'dias_semana', undefined), LUN)
  assertEquals(avanzarUnaVuelta(LUN, 'dias_semana', [9]), LUN)
})

// ============================================================
// proximaOcurrencia — dias_semana, con el caso borde del enunciado
// ============================================================

Deno.test('dias_semana: hoy ES día marcado pero la hora ya pasó → va al próximo marcado', () => {
  // El caso que no puede fallar: son las 12:00 del lunes, el recordatorio era a
  // las 09:00 del lunes y L/M/V está marcado. Tiene que irse al miércoles, no
  // quedarse vencido en el lunes para siempre.
  const ahora = Date.parse('2026-07-27T12:00:00.000Z')
  assertEquals(proximaOcurrencia(LUN, 'dias_semana', ahora, L_M_V), MIE)
})

Deno.test('dias_semana: hoy es día marcado y la hora NO pasó todavía', () => {
  // Marcado hecho por adelantado a las 07:00 del lunes: la próxima sigue siendo
  // el miércoles (se avanza desde la FECHA del recordatorio, no desde el reloj).
  const ahora = Date.parse('2026-07-27T07:00:00.000Z')
  assertEquals(proximaOcurrencia(LUN, 'dias_semana', ahora, L_M_V), MIE)
})

Deno.test('dias_semana: un atrasado de varias semanas reengancha en el próximo marcado', () => {
  // Vencido el lunes 2026-07-06; hoy es jueves 2026-07-30 al mediodía.
  // El próximo L/M/V posterior es el viernes 2026-07-31.
  const ahora = Date.parse('2026-07-30T12:00:00.000Z')
  assertEquals(
    proximaOcurrencia('2026-07-06T09:00:00.000Z', 'dias_semana', ahora, L_M_V),
    VIE,
  )
})

Deno.test('dias_semana: el resultado siempre cae en un día marcado y en el futuro', () => {
  // Barrido: todas las combinaciones no vacías de días, arrancando en cada día
  // de la semana, con distintos atrasos.
  const ahora = Date.parse('2026-07-30T12:00:00.000Z')
  const bases = [LUN, MAR, MIE, JUE, VIE, SAB, DOM]
  for (let mascara = 1; mascara < 128; mascara++) {
    const dias = [0, 1, 2, 3, 4, 5, 6].filter((d) => mascara & (1 << d))
    for (const base of bases) {
      for (const atrasoDias of [0, 3, 15, 60]) {
        const desde = new Date(new Date(base).getTime() - atrasoDias * 86_400_000).toISOString()
        const siguiente = proximaOcurrencia(desde, 'dias_semana', ahora, dias)
        const fecha = new Date(siguiente)
        if (fecha.getTime() <= ahora) {
          throw new Error(`[${dias}] desde ${desde} devolvió ${siguiente}, que no es futuro`)
        }
        if (!dias.includes(fecha.getUTCDay())) {
          throw new Error(`[${dias}] desde ${desde} devolvió ${siguiente}, día no marcado`)
        }
      }
    }
  }
})

Deno.test('dias_semana: sin días, proximaOcurrencia no gira en falso', () => {
  // Sin la guarda de "dejó de avanzar", esto iteraría MAX_VUELTAS veces.
  const ahora = Date.parse('2027-01-01T00:00:00.000Z')
  assertEquals(proximaOcurrencia(LUN, 'dias_semana', ahora, []), LUN)
})

// ============================================================
// ajustarADiaMarcado — el "enganche" de la primera ocurrencia
// ============================================================

Deno.test('ajustarADiaMarcado: si ya cae en un día marcado, no la mueve', () => {
  assertEquals(ajustarADiaMarcado(LUN, L_M_V), LUN)
  assertEquals(ajustarADiaMarcado(MIE, L_M_V), MIE)
})

Deno.test('ajustarADiaMarcado: corre la fecha al próximo día marcado', () => {
  // El usuario eligió el martes pero marcó L/M/V: la primera vez es el miércoles.
  assertEquals(ajustarADiaMarcado(MAR, L_M_V), MIE)
  // Sábado con L/M/V → lunes siguiente.
  assertEquals(ajustarADiaMarcado(SAB, L_M_V), '2026-08-03T09:00:00.000Z')
})

Deno.test('ajustarADiaMarcado: conserva la hora y nunca salta más de 6 días', () => {
  const ajustada = ajustarADiaMarcado(MAR, SOLO_MAR)
  assertEquals(ajustada, MAR) // martes con "solo martes": no se mueve
  const desdeMiercoles = ajustarADiaMarcado(MIE, SOLO_MAR)
  assertEquals(desdeMiercoles, '2026-08-04T09:00:00.000Z') // martes siguiente
  assertEquals(new Date(desdeMiercoles).getUTCHours(), 9)
})

Deno.test('ajustarADiaMarcado: sin días devuelve la fecha intacta', () => {
  assertEquals(ajustarADiaMarcado(MAR, []), MAR)
  assertEquals(ajustarADiaMarcado(MAR, null), MAR)
})

// ============================================================
// Conversión de días local ↔ UTC
// ============================================================
//
// Es el único punto del proyecto que mira la zona horaria del navegador. Los
// tests se escriben SIN asumir una zona concreta (corren igual en UTC que en
// UTC-3), verificando la propiedad que importa: que la ida y la vuelta cierren.

Deno.test('corrimientoDiaUtc: siempre es -1, 0 o +1', () => {
  for (let hora = 0; hora < 24; hora++) {
    const d = new Date(2026, 6, 27, hora, 0, 0) // 27/07/2026 local, cada hora
    const c = corrimientoDiaUtc(d)
    if (c !== -1 && c !== 0 && c !== 1) {
      throw new Error(`hora local ${hora} dio corrimiento ${c}`)
    }
  }
})

Deno.test('días locales → UTC → locales vuelve al mismo set, a cualquier hora', () => {
  // La propiedad que sostiene toda la conversión: si esto cierra, un "lunes"
  // guardado se sigue mostrando como "lunes" aunque en UTC sea martes.
  for (let hora = 0; hora < 24; hora++) {
    const instante = new Date(2026, 6, 27, hora, 30, 0)
    for (const locales of [[1], [1, 3, 5], [0, 6], [0, 1, 2, 3, 4, 5, 6]]) {
      const utc = diasLocalesAUtc(locales, instante)
      const vuelta = diasUtcALocales(utc, instante)
      assertEquals(vuelta, parseDiasSemana(locales), `hora ${hora}, días ${locales}`)
    }
  }
})

Deno.test('el día UTC de la fecha elegida queda entre los días UTC guardados', () => {
  // El invariante que la migración documenta: fecha_hora siempre cae en un día
  // marcado. Se verifica con el día LOCAL de la fecha incluido en la selección.
  for (let hora = 0; hora < 24; hora++) {
    const instante = new Date(2026, 6, 27, hora, 0, 0) // lunes local
    const diaLocal = instante.getDay()
    const utc = diasLocalesAUtc([diaLocal], instante)
    assertEquals(utc.includes(instante.getUTCDay()), true, `falla a la hora ${hora}`)
  }
})

Deno.test('proximaOcurrencia: el resultado nunca queda vencido, para cualquier atraso', () => {
  // Barrido: para atrasos de 0 a 400 días y las tres recurrencias, lo que sale
  // tiene que estar siempre en el futuro.
  for (const r of ['diario', 'semanal', 'mensual'] as const) {
    for (let dias = 0; dias <= 400; dias += 7) {
      const base = new Date(AHORA - dias * 24 * 60 * 60 * 1000).toISOString()
      const siguiente = proximaOcurrencia(base, r, AHORA)
      if (new Date(siguiente).getTime() <= AHORA) {
        throw new Error(`${r} con ${dias} días de atraso devolvió ${siguiente}, que no es futuro`)
      }
    }
  }
})
