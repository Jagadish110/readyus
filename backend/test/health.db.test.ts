import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { HAS_DB } from './db/helpers.js';

describe('health checks', () => {
  it('liveness answers without the database', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it.skipIf(!HAS_DB)('readiness confirms the database is reachable', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
