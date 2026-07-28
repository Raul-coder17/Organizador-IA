// Tests del armado de BORRADORES a partir de una acción propuesta por la IA:
// lo que precarga el `ItemForm` cuando el usuario elige "Editar antes de
// confirmar" (asistente) o "Editar antes de guardar" (foto).
// Correr con: npx deno test src/lib/accionesPropuestas.test.ts
//
// LA INVARIANTE QUE PROTEGEN: abrir la propuesta en el formulario tiene que
// mostrar EXACTAMENTE lo que se habría guardado al confirmarla sin tocarla. Si
// las dos rutas se desalinean, el usuario revisa una cosa y confirma otra — que
// es justo el problema que "editar antes de confirmar" viene a resolver.
//
// Todo lo que se prueba acá es puro: `accionesPropuestas.ts` importa `repo.ts`
// de forma DINÁMICA adentro de las funciones que escriben, así que el módulo
// carga bajo Deno sin arrastrar Supabase ni IndexedDB.
import { assertEquals } from 'jsr:@std/assert@1'
import {
  borradorDeAccionCrear,
  borradorDeAccionEditar,
  datosFinalesDeItem,
  fechaLocalDeAccion,
  lineasConCambios,
  lineasDeItem,
} from './accionesPropuestas.ts'
import { isoToDatetimeLocal } from './fechaLocal.ts'
import { diasUtcALocales } from './recurrencia.ts'
import type { AccionCrear, AccionEditar } from '../types/assistant.ts'
import type { Item, LineaLista, Recordatorio } from '../types/database.ts'

function accionCrear(overrides: Partial<AccionCrear> = {}): AccionCrear {
  return {
    tipo_accion: 'create',
    tipo: 'nota',
    tema: null,
    prioridad: null,
    contenido: 'Algo',
    ...overrides,
  }
}

function accionEditar(cambios: AccionEditar['cambios']): AccionEditar {
  return { tipo_accion: 'update', item_id: 'item-1', cambios }
}

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    user_id: 'u1',
    tema_id: 'tema-1',
    tipo: 'nota',
    prioridad: 'baja',
    contenido: { texto: 'Contenido viejo' },
    origen: 'manual',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function recordatorio(overrides: Partial<Recordatorio> = {}): Recordatorio {
  return {
    id: 'rec-1',
    item_id: 'item-1',
    fecha_hora: '2026-08-03T12:00:00.000Z',
    estado: 'pendiente',
    recurrencia: null,
    recurrencia_dias: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function lista(textos: [string, boolean][]): LineaLista[] {
  return textos.map(([texto, hecho], i) => ({ id: `l${i}`, texto, hecho }))
}

// --- create ---------------------------------------------------------------

Deno.test('create: la fecha precargada es la MISMA que calcularía confirmar sin editar', () => {
  // "diario" con hora sola es el caso donde la fecha no la elige nadie: la
  // calcula el cliente. Si el borrador la calculara por su cuenta, revisar la
  // propuesta podría mostrar otro día que el que se iba a guardar.
  const accion = accionCrear({
    tipo: 'recordatorio',
    contenido: 'Tomar la pastilla',
    recordatorio_hora: '09:00',
    recordatorio_recurrencia: 'diario',
  })
  const borrador = borradorDeAccionCrear(accion, 'texto')
  assertEquals(borrador.recordatorio?.fechaLocal, fechaLocalDeAccion(accion))
  assertEquals(borrador.recordatorio?.recurrencia, 'diario')
  assertEquals(borrador.recordatorio?.dias, [])
})

Deno.test('create: los días específicos viajan tal cual (ya vienen en escala local)', () => {
  const accion = accionCrear({
    tipo: 'recordatorio',
    contenido: 'Ir al gym',
    recordatorio_hora: '07:00',
    recordatorio_recurrencia: 'dias_semana',
    recordatorio_dias: [1, 3, 5],
  })
  const borrador = borradorDeAccionCrear(accion, 'texto')
  assertEquals(borrador.recordatorio?.dias, [1, 3, 5])
  assertEquals(borrador.recordatorio?.recurrencia, 'dias_semana')
})

Deno.test('create: sin recordatorio propuesto el borrador lo dice explícito (null, no undefined)', () => {
  // null y undefined significan cosas distintas en el form: null es "no lleva
  // recordatorio", undefined sería "no se toca el que ya haya". En un create no
  // hay item detrás, así que nunca puede ser undefined.
  const borrador = borradorDeAccionCrear(accionCrear(), 'foto')
  assertEquals(borrador.recordatorio, null)
})

Deno.test('create: las líneas de una lista arrancan sin marcar y conservan el texto', () => {
  const borrador = borradorDeAccionCrear(
    accionCrear({ tipo: 'lista', contenido: undefined, lineas: ['leche', 'pan'] }),
    'texto',
  )
  assertEquals(
    borrador.lineas.map((l) => [l.texto, l.hecho]),
    [
      ['leche', false],
      ['pan', false],
    ],
  )
})

Deno.test('create: una tabla se aplana al texto con pipes que el form sabe editar', () => {
  const borrador = borradorDeAccionCrear(
    accionCrear({
      tipo: 'tabla',
      contenido: undefined,
      columnas: ['Producto', 'Precio'],
      filas: [['Leche', '1200']],
    }),
    'foto',
  )
  assertEquals(borrador.contenidoTexto, 'Producto | Precio\nLeche | 1200')
  assertEquals(borrador.origen, 'foto')
})

// --- líneas ---------------------------------------------------------------

Deno.test('lineasConCambios: quitar, marcar, desmarcar y agregar, sin perder el resto', () => {
  const actuales = lista([
    ['leche', false],
    ['pan', true],
    ['huevos', false],
  ])
  const resultado = lineasConCambios(actuales, {
    lineas_quitar: ['huevos'],
    lineas_marcar_hechas: ['leche'],
    lineas_desmarcar: ['pan'],
    lineas_agregar: ['yerba'],
  })
  assertEquals(
    resultado.map((l) => [l.texto, l.hecho]),
    [
      ['leche', true],
      ['pan', false],
      ['yerba', false],
    ],
  )
})

Deno.test('lineasConCambios: el modelo no tiene que acertar mayúsculas ni espacios', () => {
  const resultado = lineasConCambios(lista([['Leche entera', false]]), {
    lineas_marcar_hechas: ['  leche ENTERA '],
  })
  assertEquals(resultado[0].hecho, true)
})

Deno.test('lineasDeItem: un item que no es lista no aporta líneas', () => {
  assertEquals(lineasDeItem(item()), [])
  assertEquals(lineasDeItem(undefined), [])
})

// --- update ---------------------------------------------------------------

Deno.test('update: lo que la propuesta no toca se conserva del item real', () => {
  const borrador = borradorDeAccionEditar(
    accionEditar({ contenido: 'Contenido nuevo' }),
    item({ tipo: 'nota', prioridad: 'alta' }),
    'Casa',
    null,
  )
  assertEquals(borrador.contenidoTexto, 'Contenido nuevo')
  assertEquals(borrador.tipo, 'nota')
  assertEquals(borrador.prioridad, 'alta')
  assertEquals(borrador.temaNombre, 'Casa')
})

Deno.test('update: "sacale el tema" (tema: null explícito) no es lo mismo que no tocarlo', () => {
  const conNull = borradorDeAccionEditar(accionEditar({ tema: null }), item(), 'Casa', null)
  assertEquals(conNull.temaNombre, null)

  const sinMencionarlo = borradorDeAccionEditar(accionEditar({ prioridad: 'alta' }), item(), 'Casa', null)
  assertEquals(sinMencionarlo.temaNombre, 'Casa')
})

Deno.test('update: si la propuesta no habla del recordatorio, el borrador no lo fija', () => {
  // undefined = "no lo toques": el form carga el que el item ya tenga, con su
  // carga async de siempre.
  const borrador = borradorDeAccionEditar(accionEditar({ prioridad: 'alta' }), item(), null, recordatorio())
  assertEquals(borrador.recordatorio, undefined)
})

Deno.test('update: quitar_recordatorio deja el borrador en null (toggle apagado)', () => {
  const borrador = borradorDeAccionEditar(
    accionEditar({ quitar_recordatorio: true }),
    item(),
    null,
    recordatorio(),
  )
  assertEquals(borrador.recordatorio, null)
})

Deno.test('update: mover la hora NO puede perder el "todos los días" que ya estaba', () => {
  // El bug que `applyAction` documenta: `upsertRecordatorio` pisa fecha Y
  // recurrencia de una, así que lo que la acción no trae hay que completarlo con
  // lo actual. El borrador tiene que hacer exactamente lo mismo, o revisar la
  // propuesta mostraría un recordatorio que dejó de repetirse.
  const existente = recordatorio({ recurrencia: 'diario' })
  const borrador = borradorDeAccionEditar(
    accionEditar({ recordatorio_hora: '10:00' }),
    item(),
    null,
    existente,
  )
  assertEquals(borrador.recordatorio?.recurrencia, 'diario')
  assertEquals(borrador.recordatorio?.fechaLocal?.slice(11), '10:00')
})

Deno.test('update: los días guardados vuelven a escala local antes de mostrarse', () => {
  // Se guardan en UTC; el form marca chips locales. Sin la conversión, mover la
  // hora de un "lunes y miércoles" le correría los días en pantalla.
  const existente = recordatorio({ recurrencia: 'dias_semana', recurrencia_dias: [1, 3] })
  const borrador = borradorDeAccionEditar(
    accionEditar({ recordatorio_recurrencia: 'dias_semana' }),
    item(),
    null,
    existente,
  )
  assertEquals(borrador.recordatorio?.dias, diasUtcALocales([1, 3], new Date(existente.fecha_hora)))
})

Deno.test('update: sin fecha nueva se conserva la del recordatorio existente', () => {
  const existente = recordatorio()
  const borrador = borradorDeAccionEditar(
    accionEditar({ recordatorio_recurrencia: 'semanal' }),
    item(),
    null,
    existente,
  )
  assertEquals(borrador.recordatorio?.fechaLocal, isoToDatetimeLocal(existente.fecha_hora))
  assertEquals(borrador.recordatorio?.recurrencia, 'semanal')
})

Deno.test('update: cambiar la recurrencia de un item SIN recordatorio no inventa uno', () => {
  const borrador = borradorDeAccionEditar(
    accionEditar({ recordatorio_recurrencia: 'semanal' }),
    item(),
    null,
    null,
  )
  assertEquals(borrador.recordatorio, undefined)
})

Deno.test('update: editar una lista preserva lo que ya estaba marcado', () => {
  const conLista = item({
    tipo: 'lista',
    contenido: { items: lista([['leche', true], ['pan', false]]) },
  })
  const borrador = borradorDeAccionEditar(
    accionEditar({ lineas_agregar: ['yerba'] }),
    conLista,
    null,
    null,
  )
  assertEquals(
    borrador.lineas.map((l) => [l.texto, l.hecho]),
    [
      ['leche', true],
      ['pan', false],
      ['yerba', false],
    ],
  )
})

Deno.test('update: una lista que la propuesta no toca llega entera al form', () => {
  const conLista = item({
    tipo: 'lista',
    contenido: { items: lista([['leche', true]]) },
  })
  const borrador = borradorDeAccionEditar(accionEditar({ prioridad: 'alta' }), conLista, null, null)
  assertEquals(
    borrador.lineas.map((l) => [l.texto, l.hecho]),
    [['leche', true]],
  )
})

// --- datos finales para el historial --------------------------------------

Deno.test('datosFinales: una nota informa su contenido y el recordatorio que quedó', () => {
  const rec = recordatorio({ recurrencia: 'diario' })
  const datos = datosFinalesDeItem(
    item({ prioridad: 'media', contenido: { texto: 'Lo que el usuario dejó' } }),
    'Salud',
    rec,
  )
  assertEquals(datos, {
    item_id: 'item-1',
    tipo: 'nota',
    tema: 'Salud',
    prioridad: 'media',
    contenido: 'Lo que el usuario dejó',
    recordatorio: { fecha_hora: rec.fecha_hora, recurrencia: 'diario' },
  })
})

Deno.test('datosFinales: una lista informa sus líneas con el marcado, no un texto', () => {
  const datos = datosFinalesDeItem(
    item({ tipo: 'lista', contenido: { items: lista([['leche', true], ['pan', false]]) } }),
    null,
    null,
  )
  assertEquals(datos.lineas, [
    { texto: 'leche', hecho: true },
    { texto: 'pan', hecho: false },
  ])
  assertEquals(datos.contenido, undefined)
  assertEquals(datos.recordatorio, null)
})
