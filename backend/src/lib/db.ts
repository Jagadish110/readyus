import pg from 'pg';
import { config } from '../config.js';
import { AppError } from './errors.js';

// Supabase's web API returned numeric and bigint columns as JSON numbers; node-postgres
// returns them as strings. Matching the old behaviour keeps every screen's types honest.
pg.types.setTypeParser(1700, (value) => Number(value)); // numeric
pg.types.setTypeParser(20, (value) => Number(value)); // bigint (counts)

/**
 * Direct Postgres access, so nothing outside this server needs the Supabase data API.
 *
 * Three ways in, from least to most privileged:
 *  - asAnon:    a visitor who is not signed in (the public shop catalogue).
 *  - asUser:    a signed-in person. The role is set to `authenticated` and their id
 *               is placed in the JWT claims `auth.uid()` reads, so row level security
 *               and every existing database function behave exactly as before.
 *  - asService: this server acting for itself (webhooks, payouts, scheduled jobs). It
 *               bypasses row level security, so only code that has already decided
 *               what is allowed may use it.
 */
let pool: pg.Pool | null = null;

function getPool() {
  if (!config.DATABASE_URL) {
    throw new AppError(503, 'The server is not connected to the database yet.', 'DATABASE_NOT_CONFIGURED');
  }
  pool ??= new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Supabase's pooler requires TLS; its certificate chain is not in Node's store.
    ssl: { rejectUnauthorized: false }
  });
  return pool;
}

/** Narrow query surface, so a route cannot reach for the raw connection. */
export type Q = {
  /** All rows. Always pass values as $1, $2, ... parameters, never by string concatenation. */
  rows: <T>(sql: string, values?: unknown[]) => Promise<T[]>;
  /** First row or null. */
  one: <T>(sql: string, values?: unknown[]) => Promise<T | null>;
};

async function inTransaction<T>(setup: ((client: pg.PoolClient) => Promise<void>) | null, work: (q: Q) => Promise<T>) {
  const client = await getPool().connect();
  const q: Q = {
    rows: async <R>(sql: string, values: unknown[] = []) => (await client.query(sql, values)).rows as R[],
    one: async <R>(sql: string, values: unknown[] = []) =>
      ((await client.query(sql, values)).rows[0] as R | undefined) ?? null
  };

  try {
    await client.query('begin');
    // `true` scopes the settings to this transaction, which is what makes pooled
    // connections safe to reuse for the next caller.
    if (setup) await setup(client);
    const result = await work(q);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function asUser<T>(userId: string, work: (q: Q) => Promise<T>): Promise<T> {
  return inTransaction(async (client) => {
    await client.query(
      `select set_config('role', 'authenticated', true),
              set_config('request.jwt.claims', $1, true),
              set_config('request.jwt.claim.sub', $2, true)`,
      [JSON.stringify({ sub: userId, role: 'authenticated' }), userId]
    );
  }, work);
}

export function asAnon<T>(work: (q: Q) => Promise<T>): Promise<T> {
  return inTransaction(async (client) => {
    await client.query(
      `select set_config('role', 'anon', true), set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ role: 'anon' })]
    );
  }, work);
}

export function asService<T>(work: (q: Q) => Promise<T>): Promise<T> {
  return inTransaction(null, work);
}

/** The text a database function raised, e.g. "INSUFFICIENT_STOCK:Paneer". */
export function databaseMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function closeDb() {
  await pool?.end();
}
