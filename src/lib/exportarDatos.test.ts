// Tests del armado de la exportación (JSON y CSV).
// Correr con: npx deno test src/lib/exportarDatos.test.ts
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  armarDatosExport,
  celdaCSV,
  construirCSV,
  construirJSON,
  contenidoLegible,
} from './exportarDatos.ts'
import type { Item, Recordatorio, Tema } from '../types/database.ts'

const USUARIO = { email: 'test@ejemplo.com', nombre: 'Test' }
const GENERADO = '2026-07-27T12:00:00.000Z'

function tema(over: Partial<Tema> = {}): Tema {
  return {
    id: 't1',
    user_id: 'u1',
    nombre: 'Compras',
    color: 'celeste',
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-01T10:00:00.000Z',
    ...over,
  } as Tema
}

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    user_id: 'u1',
    tema_id: 't1',
    tipo: 'nota',
    prioridad: null,
    contenido: { texto: 'una nota' },
    origen: 'manual',
    created_at: '2026-07-02T09:30:00.000Z',
    updated_at: '2026-07-02T09:30:00.000Z',
    ...over,
  } as Item
}

// Parser de CSV según RFC 4180: es lo que hace de verdad la prueba, porque
// verifica lo que va a leer Excel, no lo que nosotros creemos haber escrito.
function parsearCSV(texto: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let enComillas = false

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]
    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else enComillas = false
      } else campo += ch
      continue
    }
    if (ch === '"') enComillas = true
    else if (ch === ';') {
      fila.push(campo)
      campo = ''
    } else if (ch === '\r' && texto[i + 1] === '\n') {
      fila.push(campo)
      filas.push(fila)
      fila = []
      campo = ''
      i++
    } else campo += ch
  }
  fila.push(campo)
  filas.push(fila)
  return filas
}

// --- contenidoLegible: la tabla COMPLETA, no el resumen -------------------

Deno.test('contenidoLegible vuelca la tabla entera, no encabezados + conteo', () => {
  const texto = contenidoLegible({
    tipo: 'tabla',
    contenido: {
      columnas: ['Categoría', 'Detalle'],
      filas: [
        ['Lema', 'No hay mejor triángulo amoroso'],
        ['Pagos', 'Tarjeta y transferencia'],
      ],
    },
  })
  assertEquals(
    texto,
    'Categoría | Detalle\nLema | No hay mejor triángulo amoroso\nPagos | Tarjeta y transferencia',
  )
})

Deno.test('contenidoLegible lee también la forma vieja de tabla (texto con pipes)', () => {
  const texto = contenidoLegible({
    tipo: 'tabla',
    contenido: { texto: 'A | B\n1 | 2' },
  })
  assertEquals(texto, 'A | B\n1 | 2')
})

Deno.test('contenidoLegible marca lo hecho en una lista', () => {
  const texto = contenidoLegible({
    tipo: 'lista',
    contenido: { items: [{ texto: 'pan', hecho: true }, { texto: 'leche', hecho: false }] },
  })
  assertEquals(texto, '[x] pan\n[ ] leche')
})

Deno.test('contenidoLegible devuelve el texto plano de una nota', () => {
  assertEquals(contenidoLegible({ tipo: 'nota', contenido: { texto: '  hola  ' } }), 'hola')
})

// --- celdaCSV: RFC 4180 ----------------------------------------------------

Deno.test('celdaCSV no quotea lo que no lo necesita', () => {
  assertEquals(celdaCSV('simple'), 'simple')
})

Deno.test('celdaCSV quotea el separador', () => {
  assertEquals(celdaCSV('Compras; urgente'), '"Compras; urgente"')
})

Deno.test('celdaCSV duplica las comillas internas', () => {
  assertEquals(celdaCSV('Tema "raro"'), '"Tema ""raro"""')
})

Deno.test('celdaCSV preserva el salto de línea quoteándolo (no lo destruye)', () => {
  assertEquals(celdaCSV('linea1\nlinea2'), '"linea1\nlinea2"')
})

Deno.test('celdaCSV normaliza el CR pelado a \\n y lo quotea (era el que rompía)', () => {
  // Antes salía crudo y sin comillas: Excel lo leía como fin de fila.
  assertEquals(celdaCSV('linea1\rlinea2'), '"linea1\nlinea2"')
  assertEquals(celdaCSV('linea1\r\nlinea2'), '"linea1\nlinea2"')
})

// --- El caso hostil: ";", comillas y saltos juntos -------------------------

Deno.test('CSV con separador, comillas y saltos en los datos NO corre las columnas', () => {
  const datos = armarDatosExport(
    [tema({ nombre: 'Casa; "la buena"\ny el patio' })],
    [
      item({
        tipo: 'tabla',
        prioridad: 'alta',
        contenido: {
          columnas: ['Cosa; con punto y coma', 'Nota'],
          filas: [
            ['Dijo "hola"', 'linea A\nlinea B'],
            ['con\rCR pelado', 'normal'],
          ],
        },
      }),
    ],
    [],
    USUARIO,
    GENERADO,
  )

  const csv = construirCSV(datos)
  const filas = parsearCSV(csv)

  // Lo que importa: dos filas, y las dos con exactamente 6 campos.
  assertEquals(filas.length, 2)
  assertEquals(filas[0].length, 6)
  assertEquals(filas[1].length, 6)

  // Y cada campo llegó entero a su columna, sin correrse.
  assertEquals(filas[0], [
    'Tipo',
    'Tema',
    'Prioridad',
    'Contenido',
    'Creado',
    'Recordatorio',
  ])
  assertEquals(filas[1][0], 'tabla')
  assertEquals(filas[1][1], 'Casa; "la buena"\ny el patio')
  assertEquals(filas[1][2], 'alta')
  assertEquals(
    filas[1][3],
    'Cosa; con punto y coma | Nota\nDijo "hola" | linea A\nlinea B\ncon\nCR pelado | normal',
  )
  assertEquals(filas[1][5], '')
})

Deno.test('la tabla completa entra en la celda Contenido (las 16 filas, no un resumen)', () => {
  const filas = Array.from({ length: 16 }, (_, i) => [`fila${i}`, `valor${i}`])
  const datos = armarDatosExport(
    [tema({ nombre: 'Pizzería' })],
    [item({ tipo: 'tabla', contenido: { columnas: ['A', 'B'], filas } })],
    [],
    USUARIO,
    GENERADO,
  )

  const contenido = parsearCSV(construirCSV(datos))[1][3]
  // 16 filas + la de encabezados.
  assertEquals(contenido.split('\n').length, 17)
  assertStringIncludes(contenido, 'fila0 | valor0')
  assertStringIncludes(contenido, 'fila15 | valor15')
})

// --- Estructura del JSON ---------------------------------------------------

Deno.test('el JSON anida los recordatorios dentro de su item y agrupa por tema', () => {
  const rec: Recordatorio = {
    id: 'r1',
    item_id: 'i1',
    fecha_hora: '2026-08-01T14:00:00.000Z',
    estado: 'pendiente',
    recurrencia: 'diario',
    recurrencia_dias: null,
    created_at: GENERADO,
    updated_at: GENERADO,
  }
  const datos = armarDatosExport([tema()], [item()], [rec], USUARIO, GENERADO)

  assertEquals(datos.temas.length, 1)
  assertEquals(datos.temas[0].items.length, 1)
  assertEquals(datos.temas[0].items[0].recordatorios.length, 1)
  assertEquals(datos.temas[0].items[0].recordatorios[0].estado, 'pendiente')
  assertEquals(datos.itemsSinTema.length, 0)
})

Deno.test('el JSON conserva el contenido crudo de la tabla, sin recortar', () => {
  const contenido = { columnas: ['A', 'B'], filas: [['1', '2'], ['3', '4']] }
  const datos = armarDatosExport(
    [tema()],
    [item({ tipo: 'tabla', contenido })],
    [],
    USUARIO,
    GENERADO,
  )

  // El jsonb va tal cual (fidelidad completa)...
  assertEquals(datos.temas[0].items[0].contenido, contenido)
  // ...y además la versión legible, para no tener que reconstruirla a mano.
  assertEquals(datos.temas[0].items[0].contenidoTexto, 'A | B\n1 | 2\n3 | 4')

  // Y sobrevive al round-trip por JSON.
  const vuelta = JSON.parse(construirJSON(datos))
  assertEquals(vuelta.temas[0].items[0].contenido, contenido)
})

Deno.test('un item sin tema cae en itemsSinTema', () => {
  const datos = armarDatosExport([tema()], [item({ tema_id: null })], [], USUARIO, GENERADO)
  assertEquals(datos.temas[0].items.length, 0)
  assertEquals(datos.itemsSinTema.length, 1)
})
