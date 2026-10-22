import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import { supabase } from './supabase.js';

export type Caller = { id: string; email: string | null };

/**
 * Identifies the caller from their Supabase access token. The token is checked
 * with Supabase itself, so a revoked or expired session stops working at once;
 * nothing is trusted from the request body.
 */
export async function requireUser(request: FastifyRequest): Promise<Caller> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new AppError(401, 'Sign in to continue.');

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new AppError(401, 'Your session has expired. Sign in again.');
  return { id: data.user.id, email: data.user.email ?? null };
}
