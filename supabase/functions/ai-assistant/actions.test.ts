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
