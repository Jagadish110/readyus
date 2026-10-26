import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Builds a fresh database from the real migrations before the database tests run. Needs a
 * Postgres with PostGIS; set TEST_DATABASE_URL, e.g.
 *   postgres://postgres:postgres@localhost:5432/localty_test
 * It wipes the public, auth and storage schemas, so it refuses anything that does not look
 * like a local test database.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn('TEST_DATABASE_URL is not set: database tests are skipped.');
    return;
  }

  const target = new URL(url);
  if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname) || !/test/i.test(target.pathname)) {
    throw new Error('TEST_DATABASE_URL must be a local database whose name contains "test". Refusing to wipe it.');
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      drop publication if exists supabase_realtime;
      drop schema if exists public cascade;
      drop schema if exists auth cascade;
      drop schema if exists storage cascade;
      create schema public;
      grant all on schema public to public;
    `);

    const root = join(import.meta.dirname, '..', '..', '..');
    await client.query(readFileSync(join(import.meta.dirname, 'supabase-shim.sql'), 'utf8'));
    const dir = join(root, 'supabase', 'migrations');
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}
