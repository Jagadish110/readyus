import 'server-only';
import { createClient } from '@/lib/supabase/server';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export type ServerApiResult<T> = { ok: true; data: T } | { ok: false; status: number };

/**
 * GET from the backend while rendering a page, as the signed-in user. The
 * backend verifies the token itself, so reading it from the cookie here grants
 * nothing the user did not already have.
 */
export async function serverApi<T>(path: string): Promise<ServerApiResult<T>> {
  const supabase = await createClient();
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return { ok: false, status: 401 };

  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}
