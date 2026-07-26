// Test de paridad entre "lo que muestra la tarjeta" (ProposedActionCard) y "lo
// que realmente guarda la confirmación" (accionesPropuestas.aplicarAccionCrear),
// para una recurrencia vencida en el momento de proponerse (Auditoría del
// asistente, paso 3 / B-2).
// Correr con: npx deno test --allow-env src/components/ProposedActionCard.test.ts
//
// Necesita --allow-env porque el módulo importa JSX y el runtime automático de
// React (`react/jsx-runtime`) lee `process.env.NODE_ENV` al cargarse — no
// porque el cálculo bajo prueba use ninguna variable de entorno. Es el único
// test del repo que carga un .tsx; el resto de la suite sigue sin flags.
//
// `aplicarAccionCrear` es impura (escribe en `repo.ts`/Supabase, importado
// dinámico ahí adentro) así que acá se reconstruye SOLO su cálculo de fecha —
// llamando a las mismas tres funciones exportadas, en el mismo orden que el
// bloque `if (fechaLocal) {...}` real (ver accionesPropuestas.ts) — y se
// compara contra `primeraVezDeAccionCrear`, que es la función REAL (ahora
// exportada) que arma la tarjeta. Ninguna lógica de recurrencia se reimplementa:
// las dos rutas llaman a `fechaLocalDeAccion` + `prepararRecurrencia` +
// `primeraVuelta`, importadas tal cual.
import { assertEquals } from 'jsr:@std/assert@1'
import { primeraVezDeAccionCrear } from './ProposedActionCard.tsx'
import { datetimeLocalToIso } from '../lib/fechaLocal.ts'
import { fechaLocalDeAccion, primeraVuelta } from '../lib/accionesPropuestas.ts'
import { prepararRecurrencia } from '../lib/recurrencia.ts'
import type { AccionCrear } from '../types/assistant.ts'
import type { Recurrencia } from '../lib/recurrencia.ts'

// El mismo cálculo que el bloque `if (fechaLocal) {...}` de `aplicarAccionCrear`
// (accionesPropuestas.ts), sin la parte de I/O (crear el item, escribir el
// recordatorio). Si esto se desalinea de ese bloque, el test deja de probar lo
// que dice probar — por eso son 3 líneas que reflejan el original 1 a 1.
function fechaQueGuardaAplicarAccionCrear(accion: AccionCrear): string | null {
  const fechaLocal = fechaLocalDeAccion(accion)
  if (!fechaLocal) return null
  const listo = prepararRecurrencia(
    datetimeLocalToIso(fechaLocal),
    accion.recordatorio_recurrencia ?? null,
    accion.recordatorio_dias,
  )
  return primeraVuelta(listo.fechaIso, listo.recurrencia, listo.diasUtc)
}

function accionBase(overrides: Partial<AccionCrear>): AccionCrear {
  return {
    tipo_accion: 'create',
    tipo: 'nota',
    tema: null,
    prioridad: null,
    contenido: 'x',
    ...overrides,
  }
}

// Bien atrás en el pasado: queda "vencida" sin importar cuándo corra el test.
const VENCIDA = '2020-01-15T09:00'

Deno.test('diario vencido: la tarjeta muestra exactamente lo que guarda la confirmación', () => {
  const accion = accionBase({ recordatorio_fecha_hora: VENCIDA, recordatorio_recurrencia: 'diario' })
  const mostrado = primeraVezDeAccionCrear(accion)
  const guardado = fechaQueGuardaAplicarAccionCrear(accion)
  assertEquals(mostrado, guardado)
  assertEquals(mostrado !== null && new Date(mostrado).getTime() > Date.now(), true)
})

Deno.test('semanal vencido: la tarjeta muestra exactamente lo que guarda la confirmación', () => {
  const accion = accionBase({ recordatorio_fecha_hora: VENCIDA, recordatorio_recurrencia: 'semanal' })
  const mostrado = primeraVezDeAccionCrear(accion)
  const guardado = fechaQueGuardaAplicarAccionCrear(accion)
  assertEquals(mostrado, guardado)
  assertEquals(mostrado !== null && new Date(mostrado).getTime() > Date.now(), true)
})

Deno.test('mensual vencido: la tarjeta muestra exactamente lo que guarda la confirmación', () => {
  const accion = accionBase({ recordatorio_fecha_hora: VENCIDA, recordatorio_recurrencia: 'mensual' })
  const mostrado = primeraVezDeAccionCrear(accion)
  const guardado = fechaQueGuardaAplicarAccionCrear(accion)
  assertEquals(mostrado, guardado)
  assertEquals(mostrado !== null && new Date(mostrado).getTime() > Date.now(), true)
})

Deno.test('dias_semana vencido: la tarjeta muestra exactamente lo que guarda la confirmación (día + hora enganchados)', () => {
  const accion = accionBase({
    recordatorio_fecha_hora: VENCIDA,
    recordatorio_recurrencia: 'dias_semana',
    recordatorio_dias: [1, 3, 5],
  })
  const mostrado = primeraVezDeAccionCrear(accion)
  const guardado = fechaQueGuardaAplicarAccionCrear(accion)
  assertEquals(mostrado, guardado)
  assertEquals(mostrado !== null && new Date(mostrado).getTime() > Date.now(), true)
})

Deno.test('el bug real: sin el paso de primeraVuelta la tarjeta mostraba una fecha ya pasada', () => {
  // Reproduce el cálculo VIEJO (prepararRecurrencia solo, sin `primeraVuelta`)
  // para probar que había una diferencia real que el fix cierra — no un test
  // que pasaría igual sin el cambio.
  for (const recurrencia of ['diario', 'semanal', 'mensual'] as const satisfies readonly Recurrencia[]) {
    const accion = accionBase({ recordatorio_fecha_hora: VENCIDA, recordatorio_recurrencia: recurrencia })
    const local = fechaLocalDeAccion(accion)!
    const sinFix = prepararRecurrencia(datetimeLocalToIso(local), recurrencia, undefined).fechaIso
    const conFix = primeraVezDeAccionCrear(accion)
    assertEquals(
      new Date(sinFix).getTime() <= Date.now(),
      true,
      `${recurrencia}: la versión sin fix debía seguir vencida`,
    )
    assertEquals(conFix !== sinFix, true, `${recurrencia}: el fix debía cambiar la fecha mostrada`)
  }
})

Deno.test('una sola vez (sin recurrencia) vencida: no se toca, tarjeta y guardado quedan igual de vencidos', () => {
  // `primeraVuelta` documenta que esto es a propósito: una fecha pasada sin
  // recurrencia puede ser deliberada (anotar algo que ya pasó).
  const accion = accionBase({ recordatorio_fecha_hora: VENCIDA })
  const mostrado = primeraVezDeAccionCrear(accion)
  const guardado = fechaQueGuardaAplicarAccionCrear(accion)
  assertEquals(mostrado, guardado)
  assertEquals(mostrado, datetimeLocalToIso(VENCIDA))
})
