import { supabase } from './supabase'
import type { Item, ItemInsert } from '../types/database'

export async function listItems(userId: string): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function createItem(input: ItemInsert): Promise<Item> {
  // Generamos el UUID en el cliente (antes lo ponía el default gen_random_uuid()
  // de Postgres). Así el id es estable local↔servidor desde el insert, lo que
  // habilita crear offline y referenciar el item recién creado sin remapear al
  // sincronizar. El default del server queda como fallback si no mandamos id.
  const row = { ...input, id: input.id ?? crypto.randomUUID() }
  const { data, error } = await supabase.from('items').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function updateItem(id: string, patch: Partial<ItemInsert>): Promise<Item> {
  const { data, error } = await supabase
    .from('items')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from('items').delete().eq('id', id)
  if (error) throw error
}
