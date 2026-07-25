// Repositorio local — TODAS las mutaciones de la app pasan por acá
// (PLAN_OFFLINE.md ítem 5).
//
// Cada mutación hace dos cosas, en este orden:
//   1) escribe el espejo local en IndexedDB → la UI ve el cambio al instante,
//      con o sin red (escritura optimista);
//   2) encola la operación en el `outbox` → el motor de sync (sync.ts) la sube
//      al servidor cuando haya red.
//
// Por eso ninguna de estas funciones falla por estar sin conexión: escriben
// local y devuelven. El único disparo de red es el `requestSync()` del final,
// que es fire-and-forget.
//
// Las funciones de items.ts / temas.ts / recordatorios.ts quedaron SOLO de
// lectura contra el servidor (las usa el re-fetch de reconciliación).

import {
  deleteLocalRow,
  deleteOpsForEntity,
  enqueueOp,
  getLocalItem,
  getLocalRecordatorio,
  getLocalRecordatoriosByItem,
  getLocalTema,
  loadRecordatoriosFromCache,
  loadTemasFromCache,
  putLocalItem,
  putLocalRecordatorio,
  putLocalTema,
  type NewOutboxOp,
} from './db'
import { requestSync } from './sync'
import { joinRecordatoriosConItems } from './recordatorios'
import { loadItemsFromCache } from './db'
import { siguienteColorTema, type TemaColor } from './temaColores'
import type {
  Item,
  ItemInsert,
  Recordatorio,
  RecordatorioConItem,
  Tema,
} from '../types/database'

function nowIso(): string {
  return new Date().toISOString()
}

// Encola la op y pide un sync (que no hace nada si no hay red).
async function enqueue(op: Omit<NewOutboxOp, 'createdAt' | 'tries' | 'lastError'>): Promise<void> {
  await enqueueOp({ ...op, createdAt: nowIso(), tries: 0, lastError: null })
  requestSync()
}

// ============================================================
// Temas
// ============================================================

// Crea un tema. El color es opcional: si no viene, se asigna solo desde la
// paleta fría (decisión D4). Que el default viva ACÁ y no en el form es lo que
// garantiza que ningún camino de creación deje un tema sin color — ni el form,
// ni el asistente de IA, ni lo que venga después.
export async function createTema(
  userId: string,
  nombre: string,
  color?: TemaColor,
): Promise<Tema> {
  // El UUID lo genera el cliente (ítem 1): el id es el mismo local y en el
  // servidor, así el item que referencie este tema ya puede apuntarle antes de
  // que exista arriba.
  const ts = nowIso()
  const tema: Tema = {
    id: crypto.randomUUID(),
    user_id: userId,
    nombre,
    color: color ?? siguienteColorTema(await loadTemasFromCache(), nombre),
    created_at: ts,
    updated_at: ts,
  }
  await putLocalTema(tema)
  await enqueue({
    entity: 'tema',
    op: 'insert',
    entityId: tema.id,
    payload: { ...tema },
    baseUpdatedAt: null,
  })
  return tema
}

// Cambia el color de un tema ya creado. Pasa por el mismo camino que todo lo
// demás (espejo local + outbox), así que anda igual sin conexión: el punto
// cambia al instante en la UI y la escritura sube cuando haya red.
export async function updateTemaColor(id: string, color: TemaColor): Promise<Tema> {
  const current = await getLocalTema(id)
  if (!current) throw new Error('Ese tema ya no existe.')

  const updatedAt = nowIso()
  const next: Tema = { ...current, color, updated_at: updatedAt }
  await putLocalTema(next)
  await enqueue({
    entity: 'tema',
    op: 'update',
    entityId: id,
    // El updated_at viaja en el payload: es lo que usa la guarda LWW del motor
    // de sync para no pisar un cambio más nuevo hecho en otro dispositivo.
    payload: { color, updated_at: updatedAt },
    baseUpdatedAt: current.updated_at ?? null,
  })
  return next
}

// Cuántos items usan este tema hoy. Lo necesita la confirmación de borrado
// ("sus N items pasan a Sin tema"): se cuenta contra el espejo local, así que
// también responde sin conexión.
export async function contarItemsDeTema(temaId: string): Promise<number> {
  const items = await loadItemsFromCache()
  return items.filter((i) => i.tema_id === temaId).length
}

// Borra un tema. Sus items NO se borran: pasan a "Sin tema" (tema_id → null).
//
// El servidor ya hace justamente eso solo — la FK es
// `tema_id references temas (id) on delete set null` (schema_inicial) —, pero
// NO alcanza con confiar en la cascada, por dos motivos:
//
//  1. El espejo local no se entera de un cambio que hizo el servidor. Sin
//     nullear acá, los items quedarían apuntando a un tema que ya no está y la
//     UI los mostraría bajo "Tema eliminado" (el bucket huérfano de ItemList)
//     hasta la próxima reconciliación. El borrado intencional tiene que dar
//     "Sin tema", que es otra cosa.
//  2. El caso 100% offline: crear tema → crear item con ese tema → borrar el
//     tema, todo sin red. `planOutbox` colapsa insert+delete del tema en NADA
//     (fold, tries === 0), así que ese tema nunca va a existir en el servidor;
//     si el item conservara su `tema_id`, su insert fallaría con FK 23503 para
//     siempre. Al encolar el update del item ANTES, el fold del item pliega
//     insert+update en un solo insert con `tema_id: null` y sube limpio.
//
// Por eso el orden es el mismo que en deleteItem: primero los hijos, después
// el padre.
export async function deleteTema(id: string): Promise<void> {
  const items = await loadItemsFromCache()
  for (const item of items.filter((i) => i.tema_id === id)) {
    // updateItem ya hace espejo local + outbox + guarda LWW.
    await updateItem(item.id, { tema_id: null })
  }

  await deleteLocalRow('tema', id)
  // Las ops pendientes del tema NO se descartan a mano: el fold del outbox ya
  // resuelve insert+delete (y conserva el delete si el insert llegó a
  // intentarse, por el caso del "ack perdido").
  await enqueue({
    entity: 'tema',
    op: 'delete',
    entityId: id,
    payload: null,
    baseUpdatedAt: null,
  })
}

// ============================================================
// Items
// ============================================================

// Columnas de `items` que la UI puede editar. Filtramos el patch contra esta
// lista para no mandar al servidor cosas que no se cambian (id, user_id,
// created_at) aunque el llamador pase el payload completo del form.
const ITEM_EDITABLE = ['tema_id', 'tipo', 'prioridad', 'contenido', 'origen'] as const

function itemPatch(patch: Partial<ItemInsert>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ITEM_EDITABLE) {
    if (patch[key] !== undefined) out[key] = patch[key]
  }
  return out
}

export async function createItem(input: ItemInsert): Promise<Item> {
  const ts = nowIso()
  // created_at/updated_at los pone el cliente (no el default del servidor) para
  // que la fila local y la del servidor sean idénticas: el orden de la lista no
  // salta al reconciliar y el updated_at sirve de base para el LWW.
  const item: Item = {
    id: input.id ?? crypto.randomUUID(),
    user_id: input.user_id,
    tema_id: input.tema_id ?? null,
    tipo: input.tipo,
    prioridad: input.prioridad ?? null,
    contenido: input.contenido,
    origen: input.origen ?? null,
    created_at: input.created_at ?? ts,
    updated_at: input.updated_at ?? ts,
  }
  await putLocalItem(item)
  await enqueue({
    entity: 'item',
    op: 'insert',
    entityId: item.id,
    payload: { ...item },
    baseUpdatedAt: null,
  })
  return item
}

export async function updateItem(id: string, patch: Partial<ItemInsert>): Promise<Item> {
  const current = await getLocalItem(id)
  if (!current) throw new Error('Ese item ya no existe.')

  const updatedAt = nowIso()
  const cambios = itemPatch(patch)
  const next: Item = { ...current, ...(cambios as Partial<Item>), updated_at: updatedAt }
  await putLocalItem(next)
  await enqueue({
    entity: 'item',
    op: 'update',
    entityId: id,
    // El updated_at viaja en el payload: es el timestamp real de la edición y
    // el que usa la guarda LWW del motor de sync (§4.3).
    payload: { ...cambios, updated_at: updatedAt },
    baseUpdatedAt: current.updated_at,
  })
  return next
}

export async function deleteItem(id: string): Promise<void> {
  // El servidor borra los recordatorios del item en cascada (FK on delete
  // cascade), así que replicamos eso local y descartamos sus ops pendientes:
  // si las dejáramos, intentarían escribir contra una fila que ya no va a
  // existir y quedarían atascadas por FK para siempre.
  const recs = await getLocalRecordatoriosByItem(id)
  for (const rec of recs) {
    await deleteOpsForEntity('recordatorio', rec.id)
    await deleteLocalRow('recordatorio', rec.id)
  }

  await deleteLocalRow('item', id)
  await enqueue({
    entity: 'item',
    op: 'delete',
    entityId: id,
    payload: null,
    baseUpdatedAt: null,
  })
}

// ============================================================
// Recordatorios
// ============================================================

// El recordatorio (si existe) asociado a un item, para prellenar el form.
export async function getRecordatorioForItem(itemId: string): Promise<Recordatorio | null> {
  const recs = await getLocalRecordatoriosByItem(itemId)
  return recs[0] ?? null
}

// Crea o actualiza el recordatorio de un item (un item tiene a lo sumo uno en
// esta UI).
export async function upsertRecordatorio(itemId: string, fechaHora: string): Promise<Recordatorio> {
  const ts = nowIso()
  const existente = await getRecordatorioForItem(itemId)

  if (existente) {
    const next: Recordatorio = {
      ...existente,
      fecha_hora: fechaHora,
      estado: 'pendiente',
      updated_at: ts,
    }
    await putLocalRecordatorio(next)
    await enqueue({
      entity: 'recordatorio',
      op: 'update',
      entityId: next.id,
      payload: { fecha_hora: fechaHora, estado: 'pendiente', updated_at: ts },
      baseUpdatedAt: existente.updated_at,
    })
    return next
  }

  const rec: Recordatorio = {
    id: crypto.randomUUID(),
    item_id: itemId,
    fecha_hora: fechaHora,
    estado: 'pendiente',
    created_at: ts,
    updated_at: ts,
  }
  await putLocalRecordatorio(rec)
  await enqueue({
    entity: 'recordatorio',
    op: 'insert',
    entityId: rec.id,
    // item_id va en el payload también para el guard de dependencias del motor
    // (un recordatorio no puede subir antes que su item).
    payload: { ...rec },
    baseUpdatedAt: null,
  })
  return rec
}

// Elimina los recordatorios de un item (el toggle del form desmarcado). Si el
// recordatorio nunca llegó a subir, el insert y este delete se cancelan entre
// sí al planificar el outbox (syncCore.planOutbox).
export async function deleteRecordatoriosForItem(itemId: string): Promise<void> {
  const recs = await getLocalRecordatoriosByItem(itemId)
  for (const rec of recs) {
    await deleteLocalRow('recordatorio', rec.id)
    await enqueue({
      entity: 'recordatorio',
      op: 'delete',
      entityId: rec.id,
      payload: null,
      baseUpdatedAt: null,
    })
  }
}

async function cambiarEstado(
  id: string,
  estado: Recordatorio['estado'],
): Promise<Recordatorio> {
  const current = await getLocalRecordatorio(id)
  if (!current) throw new Error('Ese recordatorio ya no existe.')

  const ts = nowIso()
  const next: Recordatorio = { ...current, estado, updated_at: ts }
  await putLocalRecordatorio(next)
  await enqueue({
    entity: 'recordatorio',
    op: 'update',
    entityId: id,
    payload: { estado, updated_at: ts },
    baseUpdatedAt: current.updated_at,
  })
  return next
}

export async function marcarHecho(id: string): Promise<Recordatorio> {
  return cambiarEstado(id, 'hecho')
}

// Marca 'enviado' desde el aviso local. Antes esto llevaba un filtro
// `estado = 'pendiente'` en el servidor para no pisar un 'hecho'; ahora la
// guarda es local (no tocamos lo que ya no está pendiente) y, si dos
// dispositivos compiten, decide el LWW por updated_at.
export async function marcarEnviado(id: string): Promise<void> {
  const current = await getLocalRecordatorio(id)
  if (!current || current.estado !== 'pendiente') return
  await cambiarEstado(id, 'enviado')
}

// Ventana (ms) hacia adelante que mira el watcher local: los recordatorios que
// vencen dentro de los próximos ~2 min (o ya vencidos) son candidatos a armar
// un timer. Igualarla al intervalo de sondeo + margen alcanza para no perder
// ninguno entre dos sondeos.
const VENTANA_DISPARO_MS = 2 * 60 * 1000

// Recordatorios propios en estado 'pendiente' que vencen pronto o ya vencieron,
// con el item embebido para armar el cuerpo de la notificación local. Sale del
// espejo local (no de la red): por eso el aviso local sigue disparando sin
// conexión mientras la app esté abierta (PLAN_OFFLINE.md §6.2).
export async function listRecordatoriosParaDisparo(): Promise<RecordatorioConItem[]> {
  const [recs, items] = await Promise.all([loadRecordatoriosFromCache(), loadItemsFromCache()])
  const limite = new Date(Date.now() + VENTANA_DISPARO_MS).toISOString()
  const candidatos = recs.filter((r) => r.estado === 'pendiente' && r.fecha_hora <= limite)
  return joinRecordatoriosConItems(candidatos, items)
}

// Cuenta los recordatorios pendientes vencidos o que vencen hoy (badge de la
// nav), desde el espejo local: así el badge también anda sin conexión y refleja
// los cambios que todavía no subieron.
export async function countRecordatoriosPendientesHoy(): Promise<number> {
  const finDeHoy = new Date()
  finDeHoy.setHours(23, 59, 59, 999)
  const corte = finDeHoy.toISOString()

  const recs = await loadRecordatoriosFromCache()
  return recs.filter((r) => r.estado === 'pendiente' && r.fecha_hora <= corte).length
}
