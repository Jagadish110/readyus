'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config';

/**
 * Supabase client for Client Components. Returns null until the project is
 * connected, so the UI can render instead of crashing on hydration.
 */
export function createClient() {
  if (!isSupabaseConfigured()) return null;
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
