import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { requireUser } from '../src/lib/auth.js';
import { supabase } from '../src/lib/supabase.js';

/** A token shaped like Supabase's; only its expiry is read locally, Supabase (mocked here) does the checking. */
const token = (name: string, expSeconds = Math.floor(Date.now() / 1000) + 3600) =>
  `header.${Buffer.from(JSON.stringify({ sub: name, exp: expSeconds })).toString('base64url')}.signature`;

const request = (bearer: string) => ({ headers: { authorization: `Bearer ${bearer}` } }) as unknown as FastifyRequest;

const accepts = (id: string) =>
  vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: { id, email: `${id}@example.test` } }, error: null } as never);

afterEach(() => vi.restoreAllMocks());

describe('signed-in callers', () => {
  it('asks Supabase once for a token used again within seconds', async () => {
    const getUser = accepts('user-1');
    const bearer = token('one');
    expect(await requireUser(request(bearer))).toEqual({ id: 'user-1', email: 'user-1@example.test' });
    expect(await requireUser(request(bearer))).toEqual({ id: 'user-1', email: 'user-1@example.test' });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('asks again for a different token', async () => {
    const getUser = accepts('user-2');
    await requireUser(request(token('two-a')));
    await requireUser(request(token('two-b')));
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('does not remember a token past its expiry', async () => {
    const getUser = accepts('user-3');
    const expired = token('three', Math.floor(Date.now() / 1000) - 1);
    await requireUser(request(expired));
    await requireUser(request(expired));
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('answers "try again" when Supabase cannot be reached, not "signed out"', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError('fetch failed', 0)
    } as never);
    await expect(requireUser(request(token('four')))).rejects.toMatchObject({ status: 503 });
  });

  it('refuses a token Supabase rejects, and does not remember it', async () => {
    const getUser = vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('invalid JWT', 401, 'bad_jwt')
    } as never);
    const bearer = token('five');
    await expect(requireUser(request(bearer))).rejects.toMatchObject({ status: 401 });
    await expect(requireUser(request(bearer))).rejects.toMatchObject({ status: 401 });
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('refuses a request without a token', async () => {
    await expect(requireUser({ headers: {} } as unknown as FastifyRequest)).rejects.toMatchObject({ status: 401 });
  });
});
