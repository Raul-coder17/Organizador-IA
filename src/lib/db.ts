// Capa de almacenamiento local (IndexedDB) para soporte offline.
// Ver PLAN_OFFLINE.md §3.2. Hoy (ítems 3-4) se usa como CACHÉ READ-THROUGH: al
// cargar cada pantalla hidratamos desde acá (instantáneo, funciona sin red) y
// refrescamos de la red después. Los stores `outbox` y `meta` ya se crean desde
// el día 1 (aunque la escritura offline —outbox— es el ítem 5, todavía sin
// implementar) para no tener que versionar la DB de nuevo entonces.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Item, Recordatorio, Tema } from '../types/database'

// Subir DB_VERSION cuando cambie el esquema de stores/índices, y manejar el
// salto en el `upgrade` de abajo con un bloque `if (oldVersion < N)`.
const DB_NAME = 'organizador'
const DB_VERSION = 1

// Una operación pendiente de sincronizar. Se llena en el ítem 5 (escritura
// offline); acá solo se define el tipo y se crea el store desde ya.
export interface OutboxOp {
  seq?: number // autoincrement; lo asigna IndexedDB al agregar
  entity: 'tema' | 'item' | 'recordatorio'
  op: 'insert' | 'update' | 'delete'
  entityId: string
  payload: Record<string, unknown> | null
  baseUpdatedAt: string | null
  createdAt: string
  tries: number
  lastError: string | null
}

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
