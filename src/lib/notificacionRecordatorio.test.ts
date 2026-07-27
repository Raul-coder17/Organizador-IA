// Tests de contenidoNotificacion (título/cuerpo del aviso de un recordatorio).
// Correr con: npx deno test src/lib/notificacionRecordatorio.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { contenidoNotificacion } from './notificacionRecordatorio.ts'

const recSimple = { fecha_hora: '2026-07-27T12:00:00.000Z', recurrencia: null, recurrencia_dias: null }
const itemTexto = { tipo: 'nota' as const, contenido: { texto: 'Tomar la pastilla' } }

Deno.test('contenidoNotificacion: sin tema ni recurrencia, cuerpo genérico', () => {
  const { title, body } = contenidoNotificacion(recSimple, itemTexto, null)
  assertEquals(title, 'Tomar la pastilla')
  assertEquals(body, 'Tenés un recordatorio pendiente.')
})

Deno.test('contenidoNotificacion: con tema, el cuerpo es el nombre del tema', () => {
  const { title, body } = contenidoNotificacion(recSimple, itemTexto, 'Salud')
  assertEquals(title, 'Tomar la pastilla')
  assertEquals(body, 'Salud')
})

Deno.test('contenidoNotificacion: recurrente sin tema, marca "Se repite"', () => {
  const rec = { ...recSimple, recurrencia: 'diario' as const }
  const { body } = contenidoNotificacion(rec, itemTexto, null)
  assertEquals(body, 'Se repite: Cada día')
})

Deno.test('contenidoNotificacion: tema + recurrente, los dos separados por " · "', () => {
  const rec = { ...recSimple, recurrencia: 'semanal' as const }
  const { body } = contenidoNotificacion(rec, itemTexto, 'Trabajo')
  assertEquals(body, 'Trabajo · Se repite: Cada semana')
})

Deno.test('contenidoNotificacion: dias_semana usa la marca de días, no el fallback', () => {
  // Lunes en UTC (recurrencia_dias ya vive en UTC) para una fecha sin
  // corrimiento de zona (mediodía).
  const rec = {
    fecha_hora: '2026-07-27T12:00:00.000Z', // lunes
    recurrencia: 'dias_semana' as const,
    recurrencia_dias: [1, 3, 5],
  }
  const { body } = contenidoNotificacion(rec, itemTexto, null)
  assertEquals(body, 'Se repite: Lun, Mié, Vie')
})

Deno.test('contenidoNotificacion: item eliminado (null) usa el título de resumenContenido', () => {
  const { title } = contenidoNotificacion(recSimple, null, null)
  assertEquals(title, 'Item eliminado')
})

Deno.test('contenidoNotificacion: título de una lista es el mismo resumen que ve /reminders', () => {
  const itemLista = {
    tipo: 'lista' as const,
    contenido: { items: [{ texto: 'Pan' }, { texto: 'Leche' }] },
  }
  const { title } = contenidoNotificacion(recSimple, itemLista, null)
  assertEquals(title, 'Pan, Leche')
})
