export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * True once real project credentials are present. The scaffold ships with
 * placeholders so the UI can run before a project is connected; every data
 * path checks this instead of letting the Supabase client throw.
 */
export function isSupabaseConfigured() {
  return (
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_URL.includes('YOUR-PROJECT') &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.startsWith('your-')
  );
}
