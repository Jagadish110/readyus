import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { AppError } from './errors.js';
import { supabase } from './supabase.js';

export type Caller = { id: string; email: string | null };

// A page makes several API calls with the same token, so a token Supabase has just confirmed is
// trusted again for a short while instead of asking Supabase on every call. A sign-out takes effect
// within this window. Roles are not remembered: routes read them from the database on every call.
const REMEMBER_MS = 30_000;
const MAX_REMEMBERED = 10_000;
const remembered = new Map<string, { caller: Caller; until: number }>();

/** When the token expires, in ms. Read unverified, which is safe: it only shortens how long it is remembered. */
function expiresAt(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Identifies the caller from their Supabase access token. The token is checked
 * with Supabase itself, so a revoked or expired session stops working within
 * seconds; nothing is trusted from the request body.
 */
export async function requireUser(request: FastifyRequest): Promise<Caller> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new AppError(401, 'Sign in to continue.');

  const key = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  const known = remembered.get(key);
  if (known && known.until > now) return known.caller;

  const { data, error } = await supabase.auth.getUser(token);
  if (error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500)) {
    // Supabase could not be asked. That says nothing about the login, so it must not read as a sign-out.
    throw new AppError(503, 'We could not check your sign-in just now. Please try again in a moment.');
  }
  if (error || !data.user) throw new AppError(401, 'Your session has expired. Sign in again.');

  const caller = { id: data.user.id, email: data.user.email ?? null };
  remembered.delete(key);
  if (remembered.size >= MAX_REMEMBERED) {
    const oldest = remembered.keys().next().value;
    if (oldest) remembered.delete(oldest);
  }
  remembered.set(key, { caller, until: Math.min(now + REMEMBER_MS, expiresAt(token)) });
  return caller;
}
