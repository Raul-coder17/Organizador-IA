// Tests de la asignación automática de color por tema (PLAN_REDISEÑO.md ítem 6).
// Correr con: npx deno test src/lib/temaColores.test.ts
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1'
import {
  COLORES_TEMA,
  colorDeTema,
  encontrarTemaPorNombre,
  esColorTema,
  hashTexto,
  siguienteColorTema,
  temaColorVar,
  type TemaColor,
  type TemaColorRef,
} from './temaColores.ts'

function tema(color: string, created_at = '2026-07-23T12:00:00.000Z'): TemaColorRef {
  return { color, created_at }
}

Deno.test('sin temas previos devuelve el primero de la paleta', () => {
  assertEquals(siguienteColorTema([]), COLORES_TEMA[0])
})

Deno.test('no repite el color del último tema creado', () => {
  const previos = [tema(COLORES_TEMA[0], '2026-07-23T10:00:00.000Z')]
  for (let i = 0; i < 20; i++) {
    assertNotEquals(siguienteColorTema(previos, `tema-${i}`), COLORES_TEMA[0])
  }
})

Deno.test('el "último" es el de created_at más alto, no el último del array', () => {
  const previos = [
    tema(COLORES_TEMA[1], '2026-07-23T12:00:00.000Z'),
    tema(COLORES_TEMA[0], '2026-07-23T09:00:00.000Z'),
  ]
  // Ambos están usados una vez, así que los candidatos son los otros cinco;
  // el descarte tiene que caer sobre COLORES_TEMA[1], no sobre el último del array.
  const elegido = siguienteColorTema(previos, 'algo')
  assertNotEquals(elegido, COLORES_TEMA[1])
})

Deno.test('reparte la paleta entera antes de repetir un color', () => {
  const previos: TemaColorRef[] = []
  const vistos = new Set<TemaColor>()

  for (let i = 0; i < COLORES_TEMA.length; i++) {
    const color = siguienteColorTema(previos, `tema-${i}`)
    assert(!vistos.has(color), `${color} salió dos veces en la primera vuelta`)
    vistos.add(color)
    previos.push(tema(color, `2026-07-23T10:${String(i).padStart(2, '0')}:00.000Z`))
  }

  assertEquals(vistos.size, COLORES_TEMA.length)
})

Deno.test('el mismo nombre cae siempre en el mismo color, con los mismos previos', () => {
  const previos = [tema(COLORES_TEMA[0], '2026-07-23T10:00:00.000Z')]
  assertEquals(siguienteColorTema(previos, 'Compras'), siguienteColorTema(previos, 'Compras'))
})

Deno.test('ignora colores que no son de la paleta al contar usos', () => {
  const previos = [tema('rust'), tema('#ff0000'), { color: null, created_at: '2026-07-23T11:00:00.000Z' }]
  // Ninguno cuenta, así que todos los usos siguen en 0 y no hay "último" válido.
  assertEquals(siguienteColorTema(previos), COLORES_TEMA[0])
})

Deno.test('esColorTema acepta solo la paleta', () => {
  assertEquals(esColorTema('azul'), true)
  assertEquals(esColorTema('rust'), false)
  assertEquals(esColorTema(null), false)
  assertEquals(esColorTema(42), false)
})

Deno.test('colorDeTema respeta el color guardado', () => {
  assertEquals(colorDeTema({ id: 'x', color: 'violeta' }), 'violeta')
})

Deno.test('colorDeTema deriva un color estable si la fila no lo tiene', () => {
  const sinColor = { id: '2b1f0c6e-0000-4000-8000-000000000001' }
  const primero = colorDeTema(sinColor)
  assert(COLORES_TEMA.includes(primero))
  assertEquals(colorDeTema(sinColor), primero)
  assertEquals(colorDeTema({ ...sinColor, color: 'no-existe' }), primero)
})

Deno.test('hashTexto es determinista y no negativo', () => {
  assertEquals(hashTexto('Compras'), hashTexto('Compras'))
  assert(hashTexto('') >= 0)
  assert(hashTexto('Programación') >= 0)
})

Deno.test('temaColorVar arma el token, no un color literal', () => {
  assertEquals(temaColorVar('celeste'), 'var(--color-tema-celeste)')
})

// ============================================================
// encontrarTemaPorNombre — dedup por nombre (bug C-3a: temas duplicados
// cuando confirmAll aplica en el mismo lote dos acciones que crean el mismo
// tema nuevo)
// ============================================================

Deno.test('encontrarTemaPorNombre matchea sin distinguir mayúsculas/minúsculas', () => {
  const temas = [{ nombre: 'Salud' }]
  assertEquals(encontrarTemaPorNombre(temas, 'salud'), temas[0])
  assertEquals(encontrarTemaPorNombre(temas, 'SALUD'), temas[0])
  assertEquals(encontrarTemaPorNombre(temas, 'Trabajo'), undefined)
})

Deno.test('encontrarTemaPorNombre en una lista vacía no encuentra nada', () => {
  assertEquals(encontrarTemaPorNombre([], 'Salud'), undefined)
})

interface Tema {
  nombre: string
  color: TemaColor
  created_at: string
}

// `repo.createTema` (no testeable acá: necesita IndexedDB real) hace
// exactamente esto — lee el espejo local, busca con `encontrarTemaPorNombre`
// y sólo inserta si no está — así que este fake reproduce su forma para
// poder probar el invariante del bug sin la capa de IndexedDB.
function crearTemaFake(espejo: Tema[], nombre: string): Tema {
  const existente = encontrarTemaPorNombre(espejo, nombre)
  if (existente) return existente
  const nuevo: Tema = { nombre, color: siguienteColorTema(espejo, nombre), created_at: '' }
  espejo.push(nuevo)
  return nuevo
}

Deno.test('confirmAll: dos acciones del mismo lote que crean el mismo tema nuevo producen UN solo tema', () => {
  // Simula lo que pasa dentro de repo.createTema cuando confirmAll aplica dos
  // acciones 'create' seguidas que piden el mismo tema nuevo ("Salud"): cada
  // llamada lee el mismo espejo, que ya trae lo que insertó la anterior.
  const espejoLocal: Tema[] = []

  const temaDeLaPrimeraAccion = crearTemaFake(espejoLocal, 'Salud')
  const temaDeLaSegundaAccion = crearTemaFake(espejoLocal, 'Salud')

  assertEquals(espejoLocal.length, 1)
  assertEquals(temaDeLaPrimeraAccion, temaDeLaSegundaAccion)
})

Deno.test('confirmAll: nombres de tema distintos en el mismo lote sí crean temas distintos', () => {
  const espejoLocal: Tema[] = []

  crearTemaFake(espejoLocal, 'Salud')
  crearTemaFake(espejoLocal, 'Trabajo')

  assertEquals(espejoLocal.length, 2)
})
