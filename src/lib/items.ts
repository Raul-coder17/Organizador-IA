// Acceso de LECTURA a `items` en el servidor. Las mutaciones ya no viven acá:
// pasan por el repositorio local (repo.ts) y las sube el motor de sync
// (sync.ts), que es lo que hace que crear/editar/borrar funcione sin conexión.
// Esta lectura la usa el re-fetch de reconciliación.

import { supabase } from './supabase'
import type { Item } from '../types/database'

export async function listItems(userId: string): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}
