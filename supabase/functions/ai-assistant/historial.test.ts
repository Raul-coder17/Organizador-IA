// Tests de la reconstrucción del historial que se le manda a Gemini.
// Correr con: npx deno test supabase/functions/ai-assistant/historial.test.ts
//
// No necesitan Gemini ni red: `buildContents` es una función pura de
// mensajes -> contents.
import { assertEquals } from 'jsr:@std/assert@1'
import {
  buildContents,
  respuestaDeAccion,
  resumenContents,
  type GeminiContent,
} from './historial.ts'

// Las dos invariantes de forma del historial. Se chequean en casi todos los
// tests, así que van acá.
//
//  1. Nunca dos turnos 'model' seguidos (el bug de la burbuja de confirmación).
//     Dos 'user' seguidos SÍ son válidos, y sólo alrededor de un
//     functionResponse: el resultado de la tool y el mensaje siguiente.
//  2. Un content con functionResponse lleva SÓLO functionResponse. Mezclarlo con
//     texto es lo que hizo que Gemini devolviera 400.
function assertFormaValida(contents: GeminiContent[]) {
  const roles = contents.map((c) => c.role).join(',')

  for (let i = 1; i < contents.length; i++) {
    if (contents[i].role === 'model' && contents[i - 1].role === 'model') {
      throw new Error(`dos turnos 'model' seguidos en ${i - 1}/${i}: ${roles}`)
    }
    if (contents[i].role === contents[i - 1].role) {
      const alguno = esSoloFunctionResponse(contents[i]) || esSoloFunctionResponse(contents[i - 1])
      if (!alguno) {
        throw new Error(
          `dos turnos '${contents[i].role}' seguidos sin functionResponse de por medio en ${i - 1}/${i}: ${roles}`,
        )
      }
    }
  }

  for (const c of contents) {
    const parts = c.parts ?? []
    if (parts.some((p) => p.functionResponse) && !parts.every((p) => p.functionResponse)) {
      throw new Error(`content con functionResponse mezclado con otras parts: ${JSON.stringify(c)}`)
    }
  }
}

function esSoloFunctionResponse(c: GeminiContent): boolean {
  const parts = c.parts ?? []
  return parts.length > 0 && parts.every((p) => p.functionResponse)
}

const CALL_GYM = {
  tool: 'proposeCreateItem',
  args: {
    tipo: 'recordatorio',
    contenido: 'Ir al gym',
    recordatorio_recurrencia: 'dias_semana',
    recordatorio_dias: [1, 3, 5],
    recordatorio_hora: '07:00',
  },
}

Deno.test('sin acciones se comporta igual que antes: texto plano alternado', () => {
  const contents = buildContents([
    { role: 'user', text: '¿qué tengo guardado?' },
    { role: 'assistant', text: 'Tenés 3 notas.' },
    { role: 'user', text: 'gracias' },
  ])
  assertEquals(contents, [
    { role: 'user', parts: [{ text: '¿qué tengo guardado?' }] },
    { role: 'model', parts: [{ text: 'Tenés 3 notas.' }] },
    { role: 'user', parts: [{ text: 'gracias' }] },
  ])
  assertFormaValida(contents)
})

Deno.test('mensajes vacíos o sólo-UI no entran al historial', () => {
  const contents = buildContents([
    { role: 'user', text: 'creá algo' },
    { role: 'assistant', text: 'Preparé la creación.', acciones: [{ ...CALL_GYM, estado: 'aplicada', item_id: 'i-1' }] },
    // La burbuja que ve el usuario tras confirmar: no aporta nada que el
    // functionResponse no diga mejor, y colarla haría dos turnos 'model'.
    { role: 'assistant', text: 'Listo, creé el item.', solo_ui: true },
    { role: 'user', text: '   ' },
  ])
  // user + model(call) + user(functionResponse). El mensaje sólo-UI y el de
  // espacios en blanco no aportan ningún turno; si el sólo-UI se colara, habría
  // un cuarto turno 'model' pegado al functionResponse.
  assertEquals(contents.map((c) => c.role), ['user', 'model', 'user'])
  assertEquals(contents[2].parts?.length, 1) // sólo el functionResponse
  assertFormaValida(contents)
})

Deno.test('una acción confirmada viaja como functionCall + functionResponse aplicada', () => {
  const contents = buildContents([
    { role: 'user', text: 'recordame ir al gym los lunes, miércoles y viernes a las 7' },
    {
      role: 'assistant',
      text: 'Preparé la creación de un item para que la confirmes.',
      acciones: [{ ...CALL_GYM, estado: 'aplicada', item_id: 'item-gym' }],
    },
    { role: 'assistant', text: 'Listo, creé el item.', solo_ui: true },
    { role: 'user', text: 'también recordame tomar la pastilla todos los días a las 9' },
  ])

  assertFormaValida(contents)
  assertEquals(contents.map((c) => c.role), ['user', 'model', 'user', 'user'])

  // Turno del modelo: su texto + la call exacta que emitió.
  assertEquals(contents[1].parts?.[1].functionCall, {
    name: 'proposeCreateItem',
    args: CALL_GYM.args,
  })

  // El functionResponse va SOLO en su turno.
  assertEquals(contents[2].parts?.length, 1)
  const resp = contents[2].parts?.[0].functionResponse
  assertEquals(resp?.name, 'proposeCreateItem')
  assertEquals(resp?.response.resultado, 'aplicada')
  assertEquals(resp?.response.item_id, 'item-gym')

  // Y el mensaje nuevo del usuario, en el suyo.
  assertEquals(contents[3].parts, [
    { text: 'también recordame tomar la pastilla todos los días a las 9' },
  ])
})

// Regresión del 400 de Gemini: el functionResponse y el texto nuevo del usuario
// viajaban en las mismas `parts`. Un content con functionResponse tiene que
// llevar sólo functionResponse.
Deno.test('el functionResponse nunca comparte content con el texto del usuario', () => {
  const contents = buildContents([
    { role: 'user', text: 'creá A' },
    { role: 'assistant', text: 'Preparé A.', acciones: [{ ...CALL_GYM, estado: 'aplicada' }] },
    { role: 'user', text: 'ahora creá B' },
  ])
  for (const c of contents) {
    const parts = c.parts ?? []
    const conResp = parts.filter((p) => p.functionResponse).length
    if (conResp > 0) assertEquals(conResp, parts.length)
  }
  assertFormaValida(contents)
})

Deno.test('C-1: una acción cancelada queda registrada como rechazada', () => {
  const contents = buildContents([
    { role: 'user', text: 'borrá la nota del dentista' },
    {
      role: 'assistant',
      text: 'Preparé un borrado para que lo confirmes.',
      acciones: [{ tool: 'proposeDeleteItem', args: { item_id: 'nota-dentista' }, estado: 'cancelada' }],
    },
    { role: 'user', text: '¿qué notas me quedan?' },
  ])

  assertFormaValida(contents)
  const resp = contents[2].parts?.[0].functionResponse
  assertEquals(resp?.name, 'proposeDeleteItem')
  assertEquals(resp?.response.resultado, 'cancelada')
  assertEquals(resp?.response.confirmada_por_usuario, false)
  assertEquals(contents[3].parts, [{ text: '¿qué notas me quedan?' }])
})

Deno.test('una acción que falló se informa como no aplicada, con el error', () => {
  const contents = buildContents([
    { role: 'user', text: 'creá una nota' },
    {
      role: 'assistant',
      text: 'Preparé la creación.',
      acciones: [
        {
          tool: 'proposeCreateItem',
          args: { tipo: 'nota', contenido: 'x' },
          estado: 'error',
          error: 'No hay conexión.',
        },
      ],
    },
  ])
  const resp = contents[2].parts?.[0].functionResponse
  assertEquals(resp?.response.resultado, 'error')
  assertEquals(resp?.response.error, 'No hay conexión.')
})

Deno.test('una acción que el usuario ignoró no se informa como aplicada', () => {
  const contents = buildContents([
    { role: 'user', text: 'creá una nota' },
    {
      role: 'assistant',
      text: 'Preparé la creación.',
      acciones: [{ tool: 'proposeCreateItem', args: { tipo: 'nota' }, estado: 'sin_responder' }],
    },
    { role: 'user', text: 'mejor contame qué tengo' },
  ])
  assertFormaValida(contents)
  const resp = contents[2].parts?.[0].functionResponse
  assertEquals(resp?.response.resultado, 'sin_responder')
  assertEquals(resp?.response.confirmada_por_usuario, false)
})

Deno.test('varias acciones en un turno: una call y una response por cada una, en orden', () => {
  const contents = buildContents([
    { role: 'user', text: 'borrá la nota X y creá la tarea Y' },
    {
      role: 'assistant',
      text: 'Preparé 2 acciones para que las confirmes.',
      acciones: [
        { tool: 'proposeDeleteItem', args: { item_id: 'x' }, estado: 'aplicada' },
        { tool: 'proposeCreateItem', args: { tipo: 'nota', contenido: 'Y' }, estado: 'cancelada' },
      ],
    },
  ])
  assertFormaValida(contents)
  assertEquals(contents[1].parts?.length, 3) // texto + 2 calls
  assertEquals(contents[2].parts?.length, 2) // 2 functionResponse, y nada más
  assertEquals(contents[2].parts?.[0].functionResponse?.name, 'proposeDeleteItem')
  assertEquals(contents[2].parts?.[0].functionResponse?.response.resultado, 'aplicada')
  assertEquals(contents[2].parts?.[1].functionResponse?.response.resultado, 'cancelada')
})

Deno.test('dos propuestas seguidas no dejan dos turnos model consecutivos', () => {
  const contents = buildContents([
    { role: 'user', text: 'creá A' },
    { role: 'assistant', text: 'Preparé A.', acciones: [{ tool: 'proposeCreateItem', args: { contenido: 'A' }, estado: 'aplicada' }] },
    { role: 'assistant', text: 'Listo, creé el item.', solo_ui: true },
    { role: 'user', text: 'creá B' },
    { role: 'assistant', text: 'Preparé B.', acciones: [{ tool: 'proposeCreateItem', args: { contenido: 'B' }, estado: 'cancelada' }] },
  ])
  assertFormaValida(contents)
  assertEquals(contents.map((c) => c.role), ['user', 'model', 'user', 'user', 'model', 'user'])
})

Deno.test('cliente viejo: acciones sin tool caen al texto plano sin romper nada', () => {
  const contents = buildContents([
    { role: 'user', text: 'creá algo' },
    // Sin `tool`: la PWA cacheada de antes de este cambio manda sólo {role,text}.
    { role: 'assistant', text: 'Preparé la creación.', acciones: [{ estado: 'aplicada' }] },
    { role: 'user', text: 'gracias' },
  ])
  assertFormaValida(contents)
  assertEquals(contents, [
    { role: 'user', parts: [{ text: 'creá algo' }] },
    { role: 'model', parts: [{ text: 'Preparé la creación.' }] },
    { role: 'user', parts: [{ text: 'gracias' }] },
  ])
})

Deno.test('una tool que no declaramos no se reinyecta como functionCall', () => {
  const contents = buildContents([
    { role: 'user', text: 'hola' },
    { role: 'assistant', text: 'Hice algo raro.', acciones: [{ tool: 'proposeLanzarMisiles', args: {}, estado: 'aplicada' }] },
  ])
  assertEquals(contents, [
    { role: 'user', parts: [{ text: 'hola' }] },
    { role: 'model', parts: [{ text: 'Hice algo raro.' }] },
  ])
})

Deno.test('un estado desconocido nunca se informa como aplicado', () => {
  const r = respuestaDeAccion({ tool: 'proposeCreateItem', estado: 'vaya-a-saber' })
  assertEquals(r.resultado, 'sin_responder')
  assertEquals(r.confirmada_por_usuario, false)
})

Deno.test('resumenContents describe la forma y el conteo de calls', () => {
  const contents = buildContents([
    { role: 'user', text: 'creá A' },
    { role: 'assistant', text: 'Preparé A.', acciones: [{ tool: 'proposeCreateItem', args: {}, estado: 'aplicada' }] },
    { role: 'user', text: 'y B' },
  ])
  assertEquals(
    resumenContents(contents),
    'turnos=4 roles=[user,model,user,user] functionCalls=1 functionResponses=1',
  )
})
