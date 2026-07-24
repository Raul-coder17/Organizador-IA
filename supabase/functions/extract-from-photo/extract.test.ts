// Tests de la lógica pura de la extracción por foto: parseo de la respuesta de
// Gemini y normalización a una AccionCrear coherente.
// Correr con: npx deno test supabase/functions/extract-from-photo/extract.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { buildPrompt, normalizarExtraccion, parseJsonLaxo } from './extract.ts'

Deno.test('parseJsonLaxo: JSON pelado (el caso normal con responseSchema)', () => {
  const out = parseJsonLaxo('{"tipo":"nota","contenido":"hola","resumen":"una nota"}')
  assertEquals(out?.tipo, 'nota')
  assertEquals(out?.contenido, 'hola')
})

Deno.test('parseJsonLaxo: JSON envuelto en un bloque markdown', () => {
  const out = parseJsonLaxo('```json\n{"tipo":"lista","lineas":["pan"],"resumen":"x"}\n```')
  assertEquals(out?.tipo, 'lista')
  assertEquals(out?.lineas, ['pan'])
})

Deno.test('parseJsonLaxo: objeto embebido entre texto suelto', () => {
  const out = parseJsonLaxo('Acá va: {"tipo":"nota","contenido":"x","resumen":"y"} listo.')
  assertEquals(out?.tipo, 'nota')
})

Deno.test('parseJsonLaxo: basura devuelve null', () => {
  assertEquals(parseJsonLaxo('no soy json'), null)
  assertEquals(parseJsonLaxo(''), null)
  assertEquals(parseJsonLaxo('[1,2,3]'), null) // array top-level no sirve
})

Deno.test('normalizar: nota simple', () => {
  const e = normalizarExtraccion({
    tipo: 'nota',
    tema: 'Casa',
    prioridad: 'alta',
    contenido: 'Cortar el pasto',
    resumen: 'Un cartel que dice cortar el pasto.',
  })
  assertEquals(e?.accion.tipo, 'nota')
  assertEquals(e?.accion.tema, 'Casa')
  assertEquals(e?.accion.prioridad, 'alta')
  assertEquals(e?.accion.contenido, 'Cortar el pasto')
  assertEquals(e?.accion.lineas, undefined)
  assertEquals(e?.resumen, 'Un cartel que dice cortar el pasto.')
})

Deno.test('normalizar: lista escrita a mano', () => {
  const e = normalizarExtraccion({
    tipo: 'lista',
    tema: 'Súper',
    lineas: ['leche', '  pan  ', '', 'huevos'],
    resumen: 'Una lista de compras.',
  })
  assertEquals(e?.accion.tipo, 'lista')
  assertEquals(e?.accion.lineas, ['leche', 'pan', 'huevos'])
  assertEquals(e?.accion.contenido, undefined)
})

Deno.test('normalizar: tabla con columnas y filas (un recibo)', () => {
  const e = normalizarExtraccion({
    tipo: 'tabla',
    tema: 'Gastos',
    columnas: ['Producto', 'Precio'],
    filas: [
      ['Café', '3200'],
      ['Yerba', '5400'],
    ],
    resumen: 'Un recibo con dos items.',
  })
  assertEquals(e?.accion.tipo, 'tabla')
  assertEquals(e?.accion.columnas, ['Producto', 'Precio'])
  assertEquals(e?.accion.filas, [
    ['Café', '3200'],
    ['Yerba', '5400'],
  ])
})

Deno.test('normalizar: una celda vacía NO desalinea la fila', () => {
  const e = normalizarExtraccion({
    tipo: 'tabla',
    columnas: ['A', 'B', 'C'],
    filas: [['x', '', 'z']],
    resumen: 'x',
  })
  assertEquals(e?.accion.filas, [['x', '', 'z']])
})

Deno.test('normalizar: filas del todo vacías se descartan', () => {
  const e = normalizarExtraccion({
    tipo: 'tabla',
    columnas: ['A', 'B'],
    filas: [['x', 'y'], ['', ''], ['z', 'w']],
    resumen: 'x',
  })
  assertEquals(e?.accion.filas, [['x', 'y'], ['z', 'w']])
})

// Coherencia tipo ↔ datos: mandan los datos, no la etiqueta.
Deno.test('normalizar: dijo "nota" pero mandó filas => tabla', () => {
  const e = normalizarExtraccion({
    tipo: 'nota',
    columnas: ['A'],
    filas: [['1']],
    resumen: 'x',
  })
  assertEquals(e?.accion.tipo, 'tabla')
})

Deno.test('normalizar: dijo "tabla" sin filas pero con líneas => lista', () => {
  const e = normalizarExtraccion({ tipo: 'tabla', lineas: ['a', 'b'], resumen: 'x' })
  assertEquals(e?.accion.tipo, 'lista')
  assertEquals(e?.accion.lineas, ['a', 'b'])
})

Deno.test('normalizar: dijo "tabla" sin filas ni líneas pero con texto => nota', () => {
  const e = normalizarExtraccion({ tipo: 'tabla', contenido: 'algo suelto', resumen: 'x' })
  assertEquals(e?.accion.tipo, 'nota')
  assertEquals(e?.accion.contenido, 'algo suelto')
})

Deno.test('normalizar: dijo "lista" sin líneas pero con texto => nota', () => {
  const e = normalizarExtraccion({ tipo: 'lista', contenido: 'texto corrido', resumen: 'x' })
  assertEquals(e?.accion.tipo, 'nota')
  assertEquals(e?.accion.contenido, 'texto corrido')
})

Deno.test('normalizar: tipo desconocido cae a nota', () => {
  const e = normalizarExtraccion({ tipo: 'planilla', contenido: 'x', resumen: 'y' })
  assertEquals(e?.accion.tipo, 'nota')
})

Deno.test('normalizar: prioridad inválida se descarta (no rompe)', () => {
  const e = normalizarExtraccion({ tipo: 'nota', prioridad: 'urgentísima', contenido: 'x', resumen: 'y' })
  assertEquals(e?.accion.prioridad, null)
})

Deno.test('normalizar: tema vacío queda en null (sin tema)', () => {
  const e = normalizarExtraccion({ tipo: 'nota', tema: '   ', contenido: 'x', resumen: 'y' })
  assertEquals(e?.accion.tema, null)
})

// El caso "la foto no se pudo leer": Gemini responde bien formado pero sin nada
// aprovechable. Devolver null es lo que hace que el handler muestre el mensaje
// de "no pude interpretar la foto" en vez de proponer un item vacío.
Deno.test('normalizar: sin contenido, líneas ni filas devuelve null', () => {
  assertEquals(normalizarExtraccion({ tipo: 'nota', contenido: '', resumen: 'no se lee nada' }), null)
  assertEquals(normalizarExtraccion({ resumen: 'x' }), null)
})

Deno.test('normalizar: resumen faltante tiene fallback en español', () => {
  const e = normalizarExtraccion({ tipo: 'nota', contenido: 'x' })
  assertEquals(e?.resumen, 'Esto es lo que leí en la foto.')
})

Deno.test('normalizar: siempre marca tipo_accion create (misma forma que el asistente)', () => {
  const e = normalizarExtraccion({ tipo: 'nota', contenido: 'x', resumen: 'y' })
  assertEquals(e?.accion.tipo_accion, 'create')
})

Deno.test('buildPrompt: incluye los temas existentes para no inventar sinónimos', () => {
  const p = buildPrompt(['Casa', 'Trabajo'])
  assertEquals(p.includes('"Casa", "Trabajo"'), true)
  assertEquals(p.includes('EXACTAMENTE'), true)
})

Deno.test('buildPrompt: sin temas dice que proponga uno nuevo', () => {
  const p = buildPrompt([])
  assertEquals(p.includes('todavía no tiene temas'), true)
})

Deno.test('buildPrompt: la hora local entra sólo si se pasa', () => {
  assertEquals(buildPrompt([], '2026-07-24T09:00').includes('2026-07-24T09:00'), true)
  assertEquals(buildPrompt([]).includes('fecha y hora local'), false)
})
