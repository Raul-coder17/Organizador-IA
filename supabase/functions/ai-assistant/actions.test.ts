// Tests de la lógica pura de parseo/mapeo de function-calls de Gemini.
// Correr con: npx deno test supabase/functions/ai-assistant/actions.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import {
  allFunctionCalls,
  collectProposedActions,
  fallbackTextForActions,
  mapProposedAction,
  partitionCalls,
  type GeminiPart,
} from './actions.ts'

// Simula el candidate.content.parts de un turno con VARIAS function calls
// (parallel function calling): dos creates + un update en el mismo turno.
Deno.test('allFunctionCalls extrae todas las calls de un turno', () => {
  const parts: GeminiPart[] = [
    { text: 'Voy a agregar esas dos cosas y editar la lista.' },
    { functionCall: { name: 'proposeCreateItem', args: { tipo: 'nota', contenido: 'Comprar pan' } } },
    { functionCall: { name: 'proposeCreateItem', args: { tipo: 'nota', contenido: 'Llamar al dentista' } } },
    { functionCall: { name: 'proposeUpdateItem', args: { item_id: 'abc', lineas_agregar: ['leche'] } } },
  ]
  const calls = allFunctionCalls(parts)
  assertEquals(calls.length, 3)
  assertEquals(calls.map((c) => c.name), [
    'proposeCreateItem',
    'proposeCreateItem',
    'proposeUpdateItem',
  ])
})

Deno.test('partitionCalls separa lecturas de propose*', () => {
  const calls = allFunctionCalls([
    { functionCall: { name: 'listItems', args: {} } },
    { functionCall: { name: 'listRecordatorios', args: { estado: 'pendiente' } } },
    { functionCall: { name: 'proposeCreateItem', args: { tipo: 'nota', contenido: 'x' } } },
  ])
  const { reads, proposes } = partitionCalls(calls)
  assertEquals(reads.map((c) => c.name), ['listItems', 'listRecordatorios'])
  assertEquals(proposes.map((c) => c.name), ['proposeCreateItem'])
})

Deno.test('collectProposedActions arma el array de acciones (multiacción)', () => {
  const calls = allFunctionCalls([
    { functionCall: { name: 'proposeCreateItem', args: { tipo: 'nota', contenido: 'Comprar pan' } } },
    { functionCall: { name: 'proposeCreateItem', args: { tipo: 'nota', contenido: 'Llamar al dentista' } } },
    { functionCall: { name: 'proposeUpdateItem', args: { item_id: 'abc', lineas_agregar: ['leche'] } } },
  ])
  const { proposes } = partitionCalls(calls)
  const acciones = collectProposedActions(proposes)
  assertEquals(acciones.length, 3)
  assertEquals(acciones[0], {
    tipo_accion: 'create',
    tipo: 'nota',
    tema: null,
    prioridad: null,
    contenido: 'Comprar pan',
  })
  assertEquals(acciones[2], {
    tipo_accion: 'update',
    item_id: 'abc',
    cambios: { lineas_agregar: ['leche'] },
  })
})

Deno.test('proposeCreateItem con lista (líneas) + recordatorio en la misma acción', () => {
  const accion = mapProposedAction('proposeCreateItem', {
    tipo: 'lista',
    tema: 'Súper',
    lineas: ['leche', 'pan', ' '], // el vacío/espacios se descarta
    recordatorio_fecha_hora: '2026-07-23T09:00',
  })
  assertEquals(accion, {
    tipo_accion: 'create',
    tipo: 'lista',
    tema: 'Súper',
    prioridad: null,
    lineas: ['leche', 'pan'],
    recordatorio_fecha_hora: '2026-07-23T09:00',
  })
})

Deno.test('proposeCreateItem nota + recordatorio (un solo mensaje)', () => {
  const accion = mapProposedAction('proposeCreateItem', {
    tipo: 'nota',
    contenido: 'Renovar la VTV',
    recordatorio_fecha_hora: '2026-07-22T09:00',
  })
  assertEquals(accion, {
    tipo_accion: 'create',
    tipo: 'nota',
    tema: null,
    prioridad: null,
    contenido: 'Renovar la VTV',
    recordatorio_fecha_hora: '2026-07-22T09:00',
  })
})

Deno.test('proposeCreateItem con hora sola: diario y días específicos no llevan fecha', () => {
  assertEquals(
    mapProposedAction('proposeCreateItem', {
      tipo: 'recordatorio',
      contenido: 'Tomar la pastilla',
      recordatorio_hora: '9:00', // sin cero a la izquierda: se normaliza
      recordatorio_recurrencia: 'diario',
    }),
    {
      tipo_accion: 'create',
      tipo: 'recordatorio',
      tema: null,
      prioridad: null,
      contenido: 'Tomar la pastilla',
      recordatorio_hora: '09:00',
      recordatorio_recurrencia: 'diario',
    },
  )

  assertEquals(
    mapProposedAction('proposeCreateItem', {
      tipo: 'recordatorio',
      contenido: 'Ir al gym',
      recordatorio_hora: '07:00',
      recordatorio_recurrencia: 'dias_semana',
      recordatorio_dias: [1, 3, 5],
    }),
    {
      tipo_accion: 'create',
      tipo: 'recordatorio',
      tema: null,
      prioridad: null,
      contenido: 'Ir al gym',
      recordatorio_hora: '07:00',
      recordatorio_recurrencia: 'dias_semana',
      recordatorio_dias: [1, 3, 5],
    },
  )
})

Deno.test('una hora ilegible se descarta en vez de viajar hasta el cliente', () => {
  for (const basura of ['las siete', '7', '25:00', '12:60', 700, null]) {
    const accion = mapProposedAction('proposeCreateItem', {
      tipo: 'recordatorio',
      contenido: 'x',
      recordatorio_hora: basura,
      recordatorio_recurrencia: 'diario',
    })
    assertEquals(
      (accion as { recordatorio_hora?: string }).recordatorio_hora,
      undefined,
      `con ${JSON.stringify(basura)}`,
    )
  }
})

Deno.test('proposeUpdateItem también acepta hora sola', () => {
  assertEquals(
    mapProposedAction('proposeUpdateItem', {
      item_id: 'rec-1',
      recordatorio_hora: '21:30',
      recordatorio_recurrencia: 'diario',
    }),
    {
      tipo_accion: 'update',
      item_id: 'rec-1',
      cambios: { recordatorio_hora: '21:30', recordatorio_recurrencia: 'diario' },
    },
  )
})

Deno.test('proposeUpdateItem: marcar/agregar/quitar líneas y quitar recordatorio', () => {
  const accion = mapProposedAction('proposeUpdateItem', {
    item_id: 'lista-1',
    lineas_agregar: ['huevos'],
    lineas_marcar_hechas: ['leche'],
    lineas_quitar: ['pan'],
    quitar_recordatorio: true,
  })
  assertEquals(accion, {
    tipo_accion: 'update',
    item_id: 'lista-1',
    cambios: {
      lineas_agregar: ['huevos'],
      lineas_marcar_hechas: ['leche'],
      lineas_quitar: ['pan'],
      quitar_recordatorio: true,
    },
  })
})

Deno.test('las tools de lectura no producen acciones', () => {
  assertEquals(mapProposedAction('listItems', {}), null)
  assertEquals(mapProposedAction('listRecordatorios', { estado: 'pendiente' }), null)
})

Deno.test('fallbackTextForActions pluraliza según cantidad', () => {
  assertEquals(fallbackTextForActions([]), 'Preparé una acción para que la confirmes.')
  const una = collectProposedActions(
    allFunctionCalls([{ functionCall: { name: 'proposeDeleteItem', args: { item_id: 'x' } } }]),
  )
  assertEquals(fallbackTextForActions(una), 'Preparé un borrado para que lo confirmes.')
  const tres = collectProposedActions(
    allFunctionCalls([
      { functionCall: { name: 'proposeCreateItem', args: { tipo: 'nota', contenido: 'a' } } },
      { functionCall: { name: 'proposeCreateItem', args: { tipo: 'nota', contenido: 'b' } } },
      { functionCall: { name: 'proposeDeleteItem', args: { item_id: 'y' } } },
    ]),
  )
  assertEquals(fallbackTextForActions(tres), 'Preparé 3 acciones para que las confirmes.')
})

// --- Sugerir siempre tema y prioridad -------------------------------------
//
// El prompt y la tool declaration ahora le piden al modelo que mande tema Y
// prioridad en CADA create (antes eran "opcionales" y casi nunca los ponía).
// Eso cambia lo que llega, no cómo se mapea: estos tests fijan que el mapeo
// aguanta el caso nuevo —el común de ahora— y que el viejo sigue andando, para
// que un cliente con la PWA cacheada no dependa de ellos.

Deno.test('un create con tema y prioridad sugeridos llega entero a la acción', () => {
  const accion = mapProposedAction('proposeCreateItem', {
    tipo: 'recordatorio',
    tema: 'Salud',
    prioridad: 'media',
    contenido: 'Tomar la pastilla',
  })
  assertEquals(accion, {
    tipo_accion: 'create',
    tipo: 'recordatorio',
    tema: 'Salud',
    prioridad: 'media',
    contenido: 'Tomar la pastilla',
  })
})

Deno.test('las tres prioridades del enum pasan tal cual', () => {
  for (const prioridad of ['alta', 'media', 'baja']) {
    const accion = mapProposedAction('proposeCreateItem', {
      tipo: 'nota',
      contenido: 'x',
      prioridad,
    })
    assertEquals((accion as { prioridad: string | null }).prioridad, prioridad)
  }
})

Deno.test('sin tema ni prioridad la acción sigue siendo válida (null, no undefined)', () => {
  // El prompt pide sugerirlos siempre, pero "siempre" es una instrucción, no una
  // garantía: un modelo que igual los omita no puede romper la propuesta.
  const accion = mapProposedAction('proposeCreateItem', { tipo: 'nota', contenido: 'x' })
  assertEquals((accion as { tema: string | null }).tema, null)
  assertEquals((accion as { prioridad: string | null }).prioridad, null)
})
