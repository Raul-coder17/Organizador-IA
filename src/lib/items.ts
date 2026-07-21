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
  const { data, error } = await supabase.from('items').insert(input).select('*').single()
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
