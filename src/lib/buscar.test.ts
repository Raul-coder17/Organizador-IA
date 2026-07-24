// Tests del buscador global (PLAN_REDISEÑO.md ítem 9).
// Correr con: npx deno test src/lib/buscar.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { filtrarItems, filtrarTemas, normalizar, textoBuscableDeItem, tokens } from './buscar.ts'
import type { Item, Tema } from '../types/database.ts'

function item(id: string, tipo: Item['tipo'], contenido: Record<string, unknown>, tema_id: string | null = null): Item {
  return {
    id,
    user_id: 'u1',
    tema_id,
    tipo,
    prioridad: null,
    contenido,
    origen: null,
    created_at: '2026-07-23T12:00:00.000Z',
    updated_at: '2026-07-23T12:00:00.000Z',
  }
}

function tema(id: string, nombre: string): Tema {
  return {
    id,
    user_id: 'u1',
    nombre,
    color: 'celeste',
    created_at: '2026-07-23T12:00:00.000Z',
    updated_at: '2026-07-23T12:00:00.000Z',
  }
}

const NOTA = item('i1', 'nota', { texto: 'Renovar el préstamo del banco' }, 't1')
const LISTA = item('i2', 'lista', {
  items: [
    { id: 'aaaa-bbbb-cccc', texto: 'Comprar yerba', hecho: false },
    { id: 'dddd-eeee-ffff', texto: 'Llamar al plomero', hecho: true },
  ],
})
const TABLA = item('i3', 'tabla', {
  columnas: ['Mes', 'Gasto'],
  filas: [['Enero', 'Alquiler'], ['Febrero', 'Expensas']],
})
const TABLA_VIEJA = item('i4', 'tabla', { texto: 'Ciudad | Vuelo\nMendoza | 120000' })
const RECORDATORIO = item('i5', 'recordatorio', { texto: 'Turno con el dentista' }, 't2')

const TODOS = [NOTA, LISTA, TABLA, TABLA_VIEJA, RECORDATORIO]
const TEMAS = [tema('t1', 'Finanzas'), tema('t2', 'Salud')]

const ids = (items: Item[]) => items.map((i) => i.id)

Deno.test('normalizar saca tildes y mayúsculas', () => {
  assertEquals(normalizar('Préstamo ÁÉÍÓÚ ñ'), 'prestamo aeiou n')
})

Deno.test('tokens ignora espacios de más y consulta vacía', () => {
  assertEquals(tokens('  dos   palabras '), ['dos', 'palabras'])
  assertEquals(tokens('   '), [])
})

Deno.test('busca en el texto de una nota, sin importar tildes', () => {
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'prestamo')), ['i1'])
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'PRÉSTAMO')), ['i1'])
})

Deno.test('busca en las líneas de una lista', () => {
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'plomero')), ['i2'])
})

Deno.test('busca en encabezados y celdas de una tabla estructurada', () => {
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'expensas')), ['i3'])
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'gasto')), ['i3'])
})

Deno.test('busca en las tablas viejas guardadas como texto con pipes', () => {
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'mendoza')), ['i4'])
})

Deno.test('un ítem de tipo recordatorio también se busca', () => {
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'dentista')), ['i5'])
})

Deno.test('busca por nombre de tema aunque el ítem no lo mencione', () => {
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'finanzas')), ['i1'])
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'salud')), ['i5'])
})

// El caso que motivó excluir la clave `id`: los uuid de las líneas de una lista
// hacían match con casi cualquier letra suelta.
Deno.test('los ids de las líneas de una lista no son buscables', () => {
  assertEquals(textoBuscableDeItem(LISTA).includes('aaaa-bbbb-cccc'), false)
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'bbbb')), [])
})

Deno.test('varias palabras son AND, en cualquier orden', () => {
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'banco renovar')), ['i1'])
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'banco plomero')), [])
})

Deno.test('consulta vacía devuelve todo, no cero', () => {
  assertEquals(ids(filtrarItems(TODOS, TEMAS, '')), ids(TODOS))
  assertEquals(ids(filtrarItems(TODOS, TEMAS, '   ')), ids(TODOS))
})

Deno.test('sin coincidencias devuelve lista vacía', () => {
  assertEquals(ids(filtrarItems(TODOS, TEMAS, 'zzzz')), [])
})

Deno.test('filtrarTemas coincide por nombre normalizado', () => {
  assertEquals(filtrarTemas(TEMAS, 'FINAN').map((t) => t.id), ['t1'])
  assertEquals(filtrarTemas(TEMAS, 'zzz'), [])
  assertEquals(filtrarTemas(TEMAS, '').length, 2)
})

// Un ítem cuyo tema fue borrado no debe romper la búsqueda: cae en el grupo
// "Tema eliminado" de la Biblioteca y sigue siendo buscable por su contenido.
Deno.test('ítem con tema_id huérfano sigue siendo buscable por contenido', () => {
  const huerfano = item('i9', 'nota', { texto: 'Sobrevivió al borrado' }, 't-borrado')
  assertEquals(ids(filtrarItems([huerfano], TEMAS, 'sobrevivio')), ['i9'])
})
