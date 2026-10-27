export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * True once real project credentials are present. The scaffold ships with
 * placeholders so the UI can run before a project is connected; every data
 * path checks this instead of letting the Supabase client throw.
 */
export function isSupabaseConfigured() {
  // Plain http is accepted only for a local project (the Supabase CLI serves on http://127.0.0.1:54321).
  const secureEnough = SUPABASE_URL.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(SUPABASE_URL);
  return (
    secureEnough &&
    !SUPABASE_URL.includes('YOUR-PROJECT') &&
    SUPABASE_ANON_KEY.length > 20 &&
    !SUPABASE_ANON_KEY.startsWith('your-')
  );
}
