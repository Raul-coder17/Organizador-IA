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

export async function createTema(userId: string, nombre: string): Promise<Tema> {
  // UUID generado en el cliente (ver nota en items.ts): id estable local↔servidor
  // desde el insert. El default gen_random_uuid() de Postgres queda como fallback.
  const { data, error } = await supabase
    .from('temas')
    .insert({ id: crypto.randomUUID(), user_id: userId, nombre })
    .select('*')
    .single()

  if (error) throw error
  return data
}
