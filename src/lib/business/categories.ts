import { serverApi } from '@/lib/api/server';

export type Category = { mode: 'food' | 'items'; key: string; name: string };

/** Enabled categories, in display order. */
export async function loadCategories(): Promise<Category[]> {
  const result = await serverApi<{ categories: Category[] }>('/v1/seller/categories');
  return result.ok ? result.data.categories : [];
}
