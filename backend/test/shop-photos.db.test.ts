import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { asService } from '../src/lib/db.js';
import { HAS_DB, makeShop } from './db/helpers.js';

let caller = '';
vi.mock('../src/lib/auth.js', () => ({ requireUser: async () => ({ id: caller, email: 'x@example.test' }) }));
vi.mock('../src/lib/supabase.js', () => ({ supabase: { storage: { from: () => ({}) } } }));

async function app() {
  const server = Fastify();
  await server.register((await import('../src/routes/seller-console.js')).sellerConsoleRoutes, { prefix: '/v1/seller' });
  return server;
}

// What the upload link hands back: a public file inside the shop's own folder (SUPABASE_URL from vitest.config).
const own = (sellerId: string, name: string) =>
  `http://localhost:54321/storage/v1/object/public/product-images/${sellerId}/shop-${name}.jpg`;

const pictures = (sellerId: string) =>
  asService((q) => q.one<{ photo_url: string | null; banner_url: string | null }>('select photo_url, banner_url from sellers where id = $1', [sellerId]));

describe.skipIf(!HAS_DB)('shop photos (database)', () => {
  it('changes the banner and the profile photo separately, after the application set both', async () => {
    const { userId, sellerId } = await makeShop();
    caller = userId;
    const server = await app();
    const post = (body: object) => server.inject({ method: 'POST', url: '/v1/seller/shop/photo', payload: body });

    // The application form sends no slot: its one photo becomes both pictures.
    expect((await post({ url: own(sellerId, 'first') })).statusCode).toBe(200);
    expect(await pictures(sellerId)).toEqual({ photo_url: own(sellerId, 'first'), banner_url: own(sellerId, 'first') });

    expect((await post({ url: own(sellerId, 'banner'), slot: 'banner' })).statusCode).toBe(200);
    expect(await pictures(sellerId)).toEqual({ photo_url: own(sellerId, 'first'), banner_url: own(sellerId, 'banner') });

    expect((await post({ url: own(sellerId, 'logo'), slot: 'photo' })).statusCode).toBe(200);
    expect(await pictures(sellerId)).toEqual({ photo_url: own(sellerId, 'logo'), banner_url: own(sellerId, 'banner') });

    // The dashboard reads both back.
    const me = await server.inject({ method: 'GET', url: '/v1/seller/me' });
    expect(me.json().shop).toMatchObject({ photo_url: own(sellerId, 'logo'), banner_url: own(sellerId, 'banner') });
  });

  it("refuses a picture from outside the shop's own folder, and an unknown slot", async () => {
    const { userId, sellerId } = await makeShop();
    const other = await makeShop();
    caller = userId;
    const server = await app();
    const post = (body: object) => server.inject({ method: 'POST', url: '/v1/seller/shop/photo', payload: body });

    expect((await post({ url: own(other.sellerId, 'theirs'), slot: 'banner' })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await post({ url: 'https://example.com/banner.jpg', slot: 'banner' })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await post({ url: own(sellerId, 'x'), slot: 'cover' })).statusCode).toBeGreaterThanOrEqual(400);
    expect(await pictures(sellerId)).toEqual({ photo_url: null, banner_url: null });
  });
});
