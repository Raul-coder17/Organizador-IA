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
  loadRecordatoriosFromCache,
  putLocalItem,
  putLocalRecordatorio,
  putLocalTema,
  type NewOutboxOp,
} from './db'
import { requestSync } from './sync'
import type { Item, ItemInsert, Recordatorio, Tema } from '../types/database'

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

export async function createTema(userId: string, nombre: string): Promise<Tema> {
  // El UUID lo genera el cliente (ítem 1): el id es el mismo local y en el
  // servidor, así el item que referencie este tema ya puede apuntarle antes de
  // que exista arriba.
  const tema: Tema = {
    id: crypto.randomUUID(),
    user_id: userId,
    nombre,
    created_at: nowIso(),
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
