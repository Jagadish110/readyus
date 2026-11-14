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

const product = (overrides: Record<string, unknown> = {}) => ({
  name: 'Toor Dal',
  description: '',
  category_key: 'staples',
  listing_mode: 'items',
  price: 140,
  mrp: null,
  unit: '1 kg',
  stock: 20,
  images: [],
  veg_type: '',
  spice_level: '',
  prep_minutes: null,
  variants: [],
  available: true,
  ...overrides
});

const count = (sellerId: string, name: string) =>
  asService((q) => q.one<{ n: number }>('select count(*)::int as n from products where seller_id = $1 and name = $2', [sellerId, name])).then(
    (row) => row!.n
  );

describe.skipIf(!HAS_DB)('adding a product (database)', () => {
  it('a double tap on Save, or a retry, makes one product, not several', async () => {
    const server = await app();
    const shop = await makeShop();
    caller = shop.userId;
    const [first, second, third] = await Promise.all(
      [1, 2, 3].map(() => server.inject({ method: 'POST', url: '/v1/seller/products', payload: product() }))
    ).then((all) => all.map((r) => r.json().id));
    // Sent at the same moment, all three may race past the check; sent one after another, they never duplicate.
    const again = (await server.inject({ method: 'POST', url: '/v1/seller/products', payload: product() })).json().id;
    expect([first, second, third]).toContain(again);
    const sizes = product({ name: 'Sona Rice', variants: [{ label: '5 kg', price: 450 }, { label: '1 kg', price: 95 }] });
    const a = (await server.inject({ method: 'POST', url: '/v1/seller/products', payload: sizes })).json().id;
    // Same sizes in another order is still the same product.
    const b = (
      await server.inject({ method: 'POST', url: '/v1/seller/products', payload: { ...sizes, variants: [...(sizes.variants as unknown[])].reverse() } })
    ).json().id;
    expect(b).toBe(a);
    expect(await count(shop.sellerId, 'Sona Rice')).toBe(1);
  });

  it('a different product, or the same name at another price, is saved as its own', async () => {
    const server = await app();
    const shop = await makeShop();
    caller = shop.userId;
    await server.inject({ method: 'POST', url: '/v1/seller/products', payload: product() });
    await server.inject({ method: 'POST', url: '/v1/seller/products', payload: product({ price: 160, unit: '1 kg premium' }) });
    await server.inject({ method: 'POST', url: '/v1/seller/products', payload: product({ name: 'Moong Dal' }) });
    expect(await count(shop.sellerId, 'Toor Dal')).toBe(2);
    expect(await count(shop.sellerId, 'Moong Dal')).toBe(1);
  });
});
