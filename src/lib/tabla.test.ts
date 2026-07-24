// Tests del contenido de items tipo "tabla" (PLAN_REDISEÑO.md ítem 12).
// Correr con: npx deno test src/lib/tabla.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import {
  contenidoDeGrilla,
  grillaDesdeContenido,
  grillaDesdeTexto,
  leerTabla,
} from './tabla.ts'

// --- Lectura: forma estructurada (la nueva) -------------------------------

Deno.test('leerTabla lee la forma estructurada {columnas, filas}', () => {
  const t = leerTabla({ columnas: ['A', 'B'], filas: [['1', '2'], ['3', '4']] })
  assertEquals(t, { headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] })
})

Deno.test('leerTabla lee filas como objetos, en el orden de las columnas', () => {
  const t = leerTabla({ columnas: ['a', 'b'], filas: [{ b: 2, a: 1 }] })
  assertEquals(t, { headers: ['a', 'b'], rows: [['1', '2']] })
})

Deno.test('leerTabla devuelve null si no hay nada tabular', () => {
  assertEquals(leerTabla({ texto: 'una nota cualquiera' }), null)
  assertEquals(leerTabla({}), null)
})

// --- Lectura: forma vieja con pipes ---------------------------------------

Deno.test('leerTabla cae al texto con pipes cuando no hay estructura', () => {
  const t = leerTabla({ texto: 'Modulo | Estado\nFoto | Hecho\nTabla | En curso' })
  assertEquals(t, {
    headers: ['Modulo', 'Estado'],
    rows: [['Foto', 'Hecho'], ['Tabla', 'En curso']],
  })
})

Deno.test('leerTabla ignora la fila separadora de markdown', () => {
  const t = leerTabla({ texto: '| A | B |\n|---|---|\n| 1 | 2 |' })
  assertEquals(t, { headers: ['A', 'B'], rows: [['1', '2']] })
})

// --- Carga del editor -----------------------------------------------------

Deno.test('grillaDesdeContenido precarga una tabla vieja de texto con pipes', () => {
  const g = grillaDesdeContenido({ texto: 'Fruta | Precio\nPera | 100' })
  assertEquals(g, { columnas: ['Fruta', 'Precio'], filas: [['Pera', '100']] })
})

Deno.test('grillaDesdeContenido precarga la forma estructurada tal cual', () => {
  const g = grillaDesdeContenido({ columnas: ['A'], filas: [['1'], ['2']] })
  assertEquals(g, { columnas: ['A'], filas: [['1'], ['2']] })
})

Deno.test('grillaDesdeContenido empareja filas dentadas al ancho mayor', () => {
  const g = grillaDesdeContenido({ columnas: ['A'], filas: [['1', '2'], ['3']] })
  assertEquals(g, { columnas: ['A', 'Columna 2'], filas: [['1', '2'], ['3', '']] })
})

Deno.test('grillaDesdeContenido inventa encabezados si la tabla no traía', () => {
  const g = grillaDesdeContenido({ filas: [['1', '2']] })
  assertEquals(g, { columnas: ['Columna 1', 'Columna 2'], filas: [['1', '2']] })
})

Deno.test('grillaDesdeContenido arranca 2x2 vacía si no hay contenido', () => {
  const g = grillaDesdeContenido({})
  assertEquals(g, { columnas: ['Columna 1', 'Columna 2'], filas: [['', ''], ['', '']] })
})

Deno.test('grillaDesdeTexto: una sola línea con pipes son los encabezados', () => {
  assertEquals(grillaDesdeTexto('A | B'), { columnas: ['A', 'B'], filas: [['', '']] })
})

Deno.test('grillaDesdeTexto: texto sin pipes cae a una sola columna', () => {
  assertEquals(grillaDesdeTexto('uno\ndos'), {
    columnas: ['Columna 1'],
    filas: [['uno'], ['dos']],
  })
})

// --- Guardado -------------------------------------------------------------

Deno.test('contenidoDeGrilla recorta y descarta las filas vacías', () => {
  const c = contenidoDeGrilla({
    columnas: [' A ', 'B'],
    filas: [[' 1 ', '2'], ['', ''], ['3', '']],
  })
  assertEquals(c, { columnas: ['A', 'B'], filas: [['1', '2'], ['3', '']] })
})

Deno.test('contenidoDeGrilla empareja el ancho de las filas al de las columnas', () => {
  const c = contenidoDeGrilla({ columnas: ['A', 'B', 'C'], filas: [['1']] })
  assertEquals(c, { columnas: ['A', 'B', 'C'], filas: [['1', '', '']] })
})

Deno.test('contenidoDeGrilla devuelve null si no queda ninguna fila con datos', () => {
  assertEquals(contenidoDeGrilla({ columnas: ['A', 'B'], filas: [['', ''], ['', '']] }), null)
})

// --- Ida y vuelta ---------------------------------------------------------

Deno.test('una tabla vieja editada y guardada se lee igual que antes', () => {
  const viejo = { texto: 'Modulo | Estado\nFoto | Hecho\nTabla | En curso' }
  const nuevo = contenidoDeGrilla(grillaDesdeContenido(viejo))!
  assertEquals(nuevo, {
    columnas: ['Modulo', 'Estado'],
    filas: [['Foto', 'Hecho'], ['Tabla', 'En curso']],
  })
  assertEquals(leerTabla(nuevo), leerTabla(viejo))
})
