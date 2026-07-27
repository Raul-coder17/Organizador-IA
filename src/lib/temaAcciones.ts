import { contarItemsDeTema, deleteTema } from './repo'
import type { Tema } from '../types/database'

// Cuenta los items del tema, confirma con el usuario (misma redacción sin
// importar desde dónde se dispare — ItemForm o el menú "⋮" de Biblioteca) y
// borra si confirma. `false` si el usuario cancela — no toca nada. Deja que
// el llamador atrape errores del repo (offline-first: puede fallar igual sin
// conexión).
export async function borrarTemaConConfirmacion(tema: Tema): Promise<boolean> {
  const n = await contarItemsDeTema(tema.id)
  const cuenta =
    n === 0
      ? 'No tiene items.'
      : n === 1
        ? 'Su 1 item pasa a "Sin tema".'
        : `Sus ${n} items pasan a "Sin tema".`
  if (!confirm(`¿Borrar el tema "${tema.nombre}"?\n\n${cuenta}`)) return false

  await deleteTema(tema.id)
  return true
}
