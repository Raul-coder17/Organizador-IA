// Acceso de LECTURA a `temas` en el servidor (ver nota en items.ts): la
// creación de temas pasa por repo.ts y la sube sync.ts.

import { supabase } from './supabase'
import type { Tema } from '../types/database'

export async function listTemas(userId: string): Promise<Tema[]> {
  const { data, error } = await supabase
    .from('temas')
    .select('*')
    .eq('user_id', userId)
    .order('nombre', { ascending: true })

  if (error) throw error
  return data ?? []
}
