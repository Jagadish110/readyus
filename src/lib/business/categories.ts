import { loose } from './db';

export type Category = { mode: 'food' | 'items'; key: string; name: string };

/** Enabled categories, in display order. RLS already hides disabled ones. */
export async function loadCategories(supabase: object): Promise<Category[]> {
  const { data } = await loose(supabase)
    .from('categories')
    .select('mode, key, name')
    .eq('enabled', 'true')
    .order('sort', { ascending: true });
  return (data as Category[] | null) ?? [];
}
