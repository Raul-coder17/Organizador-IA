// Almacenamiento persistente (PLAN_OFFLINE.md ítem 10, adelantado).
//
// Vive en su propio archivo y no en db.ts porque `navigator.storage.persist()`
// sólo existe en el contexto de página (Window): el service worker también
// importa cosas de db.ts (repo.ts::posponerRecordatorio, para posponer un
// recordatorio desde la notificación), y en un ServiceWorkerGlobalScope ese
// método no está — `persisted()` sí, pero `persist()` no.

// Pide al navegador que marque el almacenamiento como persistente para que
// IndexedDB (y el outbox) no sea desalojado bajo presión de espacio.
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
