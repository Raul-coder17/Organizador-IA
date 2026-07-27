// Capa de almacenamiento local (IndexedDB) para soporte offline.
// Ver PLAN_OFFLINE.md §3.2. Desde los ítems 5-6, IndexedDB es la FUENTE DE
// VERDAD que leen las pantallas: los stores `temas`/`items`/`recordatorios` son
// el espejo local (se reemplazan completos en cada reconciliación) y `outbox`
// guarda las mutaciones pendientes de subir al servidor.
//
// Este módulo es solo almacenamiento: las mutaciones de negocio pasan por
// repo.ts y el motor que las sube por sync.ts.

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Item, Recordatorio, Tema } from '../types/database'
import type { QueuedOp, SyncEntity } from './syncCore'

// Subir DB_VERSION cuando cambie el esquema de stores/índices, y manejar el
// salto en el `upgrade` de abajo con un bloque `if (oldVersion < N)`.
const DB_NAME = 'organizador'
const DB_VERSION = 1

// Una operación pendiente de sincronizar. `seq` (autoincrement) define el orden
// FIFO, que ya respeta las dependencias causales (tema → item → recordatorio).
export interface OutboxOp extends QueuedOp {
  createdAt: string
  lastError: string | null
}

// Lo mismo pero sin `seq`: es lo que se encola (IndexedDB asigna el seq).
export type NewOutboxOp = Omit<OutboxOp, 'seq'>

const TABLE_STORE = {
  tema: 'temas',
  item: 'items',
  recordatorio: 'recordatorios',
} as const

// Fila del store de metadatos (lastSyncAt, etc.). `key` es el identificador.
export interface MetaRow {
  key: string
  value: unknown
}

interface OrganizadorDB extends DBSchema {
  temas: {
    key: string
    value: Tema
    indexes: { by_user: string }
  }
  items: {
    key: string
    value: Item
    indexes: { by_tema: string; by_updated: string }
  }
  recordatorios: {
    key: string
    value: Recordatorio
    indexes: { by_item: string; by_estado: string; by_fecha: string }
  }
  outbox: {
    key: number
    value: OutboxOp
    indexes: { by_entity: [string, string] }
  }
  meta: {
    key: string
    value: MetaRow
  }
}

let dbPromise: Promise<IDBPDatabase<OrganizadorDB>> | null = null

export function getDB(): Promise<IDBPDatabase<OrganizadorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OrganizadorDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Migraciones incrementales por versión. Hoy solo v1; cada salto futuro
        // agrega su propio bloque `if (oldVersion < N)` sin tocar los previos.
        if (oldVersion < 1) {
          const temas = db.createObjectStore('temas', { keyPath: 'id' })
          temas.createIndex('by_user', 'user_id')

          const items = db.createObjectStore('items', { keyPath: 'id' })
          items.createIndex('by_tema', 'tema_id')
          items.createIndex('by_updated', 'updated_at')

          const recordatorios = db.createObjectStore('recordatorios', { keyPath: 'id' })
          recordatorios.createIndex('by_item', 'item_id')
          recordatorios.createIndex('by_estado', 'estado')
          recordatorios.createIndex('by_fecha', 'fecha_hora')

          const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
          outbox.createIndex('by_entity', ['entity', 'entityId'])

          db.createObjectStore('meta', { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

// ============================================================
// Caché read-through — lecturas (hidratación instantánea, sirve offline)
// ============================================================
//
// Nota de scoping: como cada refresco online reemplaza el store completo (ver
// escrituras abajo) y la RLS del server ya devuelve solo las filas del usuario
// autenticado, la caché siempre refleja al usuario actual tras un refresco. En
// el caso raro de cambiar de cuenta en el mismo navegador estando offline,
// podrían verse datos cacheados de la cuenta anterior hasta el próximo refresco
// online. Aceptable para el alcance actual (uso personal, 1-2 dispositivos).

// Temas ordenados por nombre (igual que listTemas).
export async function loadTemasFromCache(): Promise<Tema[]> {
  const db = await getDB()
  const all = await db.getAll('temas')
  return all.sort((a, b) => a.nombre.localeCompare(b.nombre))
}

// Items ordenados por created_at descendente (igual que listItems).
export async function loadItemsFromCache(): Promise<Item[]> {
  const db = await getDB()
  const all = await db.getAll('items')
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// Recordatorios (planos, sin el item embebido) ordenados por fecha_hora
// ascendente (igual que listRecordatorios). El join con los items para la vista
// se rearma con joinRecordatoriosConItems (ver recordatorios.ts).
export async function loadRecordatoriosFromCache(): Promise<Recordatorio[]> {
  const db = await getDB()
  return db.getAllFromIndex('recordatorios', 'by_fecha')
}

// ============================================================
// Caché read-through — escrituras (reemplazo total del store)
// ============================================================
//
// Reemplazar todo el store en cada refresco mantiene la caché en espejo exacto
// del servidor, incluyendo los borrados duros (una fila que ya no viene del
// server desaparece de la caché). Es simple y correcto para el volumen de una
// app personal (PLAN_OFFLINE.md §3.5 / §4.4: borrado duro + re-fetch completo).

export async function saveTemasToCache(temas: Tema[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('temas', 'readwrite')
  await tx.store.clear()
  await Promise.all(temas.map((t) => tx.store.put(t)))
  await tx.done
}

export async function saveItemsToCache(items: Item[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('items', 'readwrite')
  await tx.store.clear()
  await Promise.all(items.map((i) => tx.store.put(i)))
  await tx.done
}

export async function saveRecordatoriosToCache(recordatorios: Recordatorio[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('recordatorios', 'readwrite')
  await tx.store.clear()
  await Promise.all(recordatorios.map((r) => tx.store.put(r)))
  await tx.done
}

// ============================================================
// Espejo local — escrituras fila a fila (mutaciones offline)
// ============================================================
//
// Las usa repo.ts para reflejar cada mutación al instante (UI optimista) antes
// de que el motor de sync la suba. El re-fetch posterior a la sincronización
// vuelve a reemplazar el store completo con lo del servidor.

export async function getLocalTema(id: string): Promise<Tema | undefined> {
  const db = await getDB()
  return db.get('temas', id)
}

export async function putLocalTema(tema: Tema): Promise<void> {
  const db = await getDB()
  await db.put('temas', tema)
}

export async function getLocalItem(id: string): Promise<Item | undefined> {
  const db = await getDB()
  return db.get('items', id)
}

export async function putLocalItem(item: Item): Promise<void> {
  const db = await getDB()
  await db.put('items', item)
}

export async function getLocalRecordatorio(id: string): Promise<Recordatorio | undefined> {
  const db = await getDB()
  return db.get('recordatorios', id)
}

export async function putLocalRecordatorio(rec: Recordatorio): Promise<void> {
  const db = await getDB()
  await db.put('recordatorios', rec)
}

// Recordatorios de un item, ordenados por fecha_hora (el más próximo primero).
export async function getLocalRecordatoriosByItem(itemId: string): Promise<Recordatorio[]> {
  const db = await getDB()
  const recs = await db.getAllFromIndex('recordatorios', 'by_item', itemId)
  return recs.sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))
}

// Borra una fila del espejo, sea de la entidad que sea. La usa el motor de
// sync cuando descubre que el servidor ya no tiene esa fila.
export async function deleteLocalRow(entity: SyncEntity, id: string): Promise<void> {
  const db = await getDB()
  await db.delete(TABLE_STORE[entity], id)
}

// ============================================================
// Outbox (PLAN_OFFLINE.md §3.2)
// ============================================================

export async function enqueueOp(op: NewOutboxOp): Promise<number> {
  const db = await getDB()
  // El store es autoIncrement: IndexedDB asigna el `seq` al agregar, así que la
  // fila entra sin él (por eso el cast: el tipo lo declara siempre presente
  // para todos los que la LEEN).
  return db.add('outbox', op as OutboxOp)
}

// Todo el outbox en orden FIFO (el índice primario ya es `seq` ascendente).
export async function getOutbox(): Promise<OutboxOp[]> {
  const db = await getDB()
  return db.getAll('outbox')
}

export async function countOutbox(): Promise<number> {
  const db = await getDB()
  return db.count('outbox')
}

export async function deleteOps(seqs: number[]): Promise<void> {
  if (seqs.length === 0) return
  const db = await getDB()
  const tx = db.transaction('outbox', 'readwrite')
  await Promise.all(seqs.map((seq) => tx.store.delete(seq)))
  await tx.done
}

// Suma un intento fallido y guarda el error. `tries` es lo que después decide
// si un insert que nunca salió se puede cancelar contra su delete (ver
// syncCore.fold) y alimenta el backoff.
export async function markOpsFailed(seqs: number[], error: string): Promise<void> {
  if (seqs.length === 0) return
  const db = await getDB()
  const tx = db.transaction('outbox', 'readwrite')
  for (const seq of seqs) {
    const row = await tx.store.get(seq)
    if (row) await tx.store.put({ ...row, tries: row.tries + 1, lastError: error })
  }
  await tx.done
}

// Descarta las ops pendientes de una entidad. Se usa al borrar un item: sus
// recordatorios los borra el servidor en cascada, así que cualquier escritura
// encolada para ellos quedaría huérfana (fallaría por FK para siempre).
export async function deleteOpsForEntity(entity: SyncEntity, entityId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('outbox', 'readwrite')
  let cursor = await tx.store.index('by_entity').openCursor(IDBKeyRange.only([entity, entityId]))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

// ============================================================
// Meta (lastSyncAt, etc.)
// ============================================================

export async function getMeta<T>(key: string): Promise<T | null> {
  const db = await getDB()
  const row = await db.get('meta', key)
  return row ? (row.value as T) : null
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  await db.put('meta', { key, value })
}

// ============================================================
// Borrado total del espejo local (borrar cuenta)
// ============================================================

// `deleteDB` no puede completar mientras otra conexión tenga la base abierta:
// se queda esperando (dispara `blocked`) hasta que se cierren. Otras pestañas
// de la app son exactamente ese caso. Como en el flujo de borrar cuenta no se
// puede colgar la UI esperando a que el usuario cierre pestañas, se le pone
// tope.
const DELETE_DB_TIMEOUT_MS = 4000

// Deja el dispositivo sin ningún dato del usuario. Se usa al borrar la cuenta:
// el servidor ya no tiene nada, así que el espejo local tampoco puede quedar.
//
// Dos pasos, en este orden y a propósito:
//   1) VACIAR los stores uno por uno. Es lo que de verdad garantiza que no
//      quede información: una transacción `readwrite` corre aunque haya otras
//      pestañas con la base abierta, sin depender de que nadie la suelte.
//   2) BORRAR la base entera, best-effort y contra un timeout. Es la limpieza
//      fina (se lleva también los stores y el nombre); si otra pestaña la
//      bloquea, no importa: después del paso 1 lo que queda es un cascarón
//      vacío.
//
// Nunca tira: es el último tramo de una operación irreversible que ya sucedió
// del lado del servidor. Devuelve si logró borrar el archivo entero, sólo para
// poder contarlo.
export async function wipeLocalDatabase(): Promise<{ vaciada: boolean; borrada: boolean }> {
  let vaciada = false
  try {
    const db = await getDB()
    const stores = ['temas', 'items', 'recordatorios', 'outbox', 'meta'] as const
    const tx = db.transaction(stores, 'readwrite')
    await Promise.all(stores.map((s) => tx.objectStore(s).clear()))
    await tx.done
    vaciada = true
    db.close()
  } catch {
    /* se intenta igual el borrado completo de abajo */
  }

  // La promesa cacheada apunta a una conexión que estamos por cerrar/borrar: se
  // suelta para que el próximo getDB() abra una base nueva y limpia.
  dbPromise = null

  try {
    const borrado = await Promise.race([
      deleteDB(DB_NAME).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), DELETE_DB_TIMEOUT_MS)),
    ])
    return { vaciada, borrada: borrado }
  } catch {
    return { vaciada, borrada: false }
  }
}

// ============================================================
// Almacenamiento persistente (PLAN_OFFLINE.md ítem 10, adelantado)
// ============================================================

// Pide al navegador que marque el almacenamiento como persistente para que
// IndexedDB (y el outbox futuro) no sea desalojado bajo presión de espacio.
// Best-effort: si el navegador no lo soporta o lo deniega, no bloquea nada.
export async function ensurePersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
    // Si ya es persistente, no volvemos a pedirlo.
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
