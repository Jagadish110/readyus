import { createClient } from '@/lib/supabase/client';

/**
 * Every data request in the browser goes to the Localty backend, never straight
 * to the database. The backend checks the Supabase login token on each call.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string };

export async function api<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  const supabase = createClient();
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) return { ok: false, status: 401, error: 'Sign in to continue.' };

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store'
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (!response.ok) {
      return { ok: false, status: response.status, error: json.error ?? 'Something went wrong.', code: json.code };
    }
    return { ok: true, status: response.status, data: json };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server. Check your connection.' };
  }
}
