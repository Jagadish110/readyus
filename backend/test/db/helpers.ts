import { randomUUID } from 'node:crypto';
import { asService, asUser } from '../../src/lib/db.js';

export const HAS_DB = Boolean(process.env.TEST_DATABASE_URL);

// Hyderabad, and a spot about 150 m away: inside any shop's delivery radius.
const SHOP_AT = { lng: 78.4867, lat: 17.385 };
const HOME_AT = { lng: 78.4880, lat: 17.3855 };

const point = (p: { lng: number; lat: number }) => `st_setsrid(st_makepoint(${p.lng}, ${p.lat}), 4326)::geography`;

export async function makeUser(label = 'user') {
  const id = randomUUID();
  await asService((q) =>
    q.rows('insert into auth.users (id, email) values ($1, $2)', [id, `${label}-${id.slice(0, 8)}@example.test`])
  );
  return id;
}

/** An approved, visible shop with one product. Approval starts its free trial. */
export async function makeShop(opts: { approved?: boolean; stock?: number } = {}) {
  const userId = await makeUser('owner');
  const sellerId = await asService(async (q) => {
    const seller = await q.one<{ id: string }>(
      `insert into sellers (user_id, shop_name, owner_name, phone, status, public_visible, location, business_open)
       values ($1, 'Test Kitchen', 'Owner', '9876543210', $2, $3, ${point(SHOP_AT)}, true) returning id`,
      [userId, opts.approved === false ? 'pending' : 'approved', opts.approved !== false]
    );
    return seller!.id;
  });
  const productId = await asService(async (q) => {
    const product = await q.one<{ id: string }>(
      `insert into products (seller_id, name, price, stock, approval_status, category_key)
       values ($1, 'Biryani', 100, $2, 'approved', $3) returning id`,
      [sellerId, opts.stock ?? 10, `cat-${sellerId.slice(0, 8)}`]
    );
    return product!.id;
  });
  return { userId, sellerId, productId, category: `cat-${sellerId.slice(0, 8)}` };
}

export async function makeCustomer() {
  const userId = await makeUser('customer');
  const addressId = await asService(async (q) => {
    const address = await q.one<{ id: string }>(
      `insert into addresses (user_id, line1, phone, recipient, city, location, is_default)
       values ($1, '12 Test Street', '9123456780', 'Customer', 'Hyderabad', ${point(HOME_AT)}, true) returning id`,
      [userId]
    );
    return address!.id;
  });
  return { userId, addressId };
}

/** Places an order exactly as the API does: as the customer, through place_order(). */
export async function placeOrder(
  customer: { userId: string; addressId: string },
  shop: { sellerId: string; productId: string },
  opts: { online?: boolean; quantity?: number } = {}
) {
  await asService((q) =>
    q.rows('insert into cart_items (user_id, product_id, seller_id, quantity) values ($1, $2, $3, $4)', [
      customer.userId,
      shop.productId,
      shop.sellerId,
      opts.quantity ?? 1
    ])
  );
  const row = await asUser(customer.userId, (q) =>
    q.one<{ id: string }>('select place_order($1, $2, $3, $4) as id', [customer.addressId, shop.sellerId, opts.online ?? false, ''])
  );
  return row!.id;
}

export const orderRow = (orderId: string) =>
  asService((q) => q.one<Record<string, any>>('select * from orders where id = $1', [orderId]));

export const stockOf = (productId: string) =>
  asService((q) => q.one<{ stock: number }>('select stock from products where id = $1', [productId])).then((r) => r!.stock);

/** Makes a delivery partner who belongs to the shop's team. */
export async function makeRider(sellerId: string) {
  const userId = await makeUser('rider');
  await asService(async (q) => {
    const agent = await q.one<{ id: string }>(
      `insert into delivery_agents (user_id, full_name, phone, vehicle, status) values ($1, 'Rider', '9000000000', 'bike', 'approved') returning id`,
      [userId]
    );
    await q.rows('insert into user_roles (user_id, role) values ($1, $2) on conflict do nothing', [userId, 'delivery']);
    await q.rows('insert into delivery_relationships (seller_id, agent_id) values ($1, $2)', [sellerId, agent!.id]);
  });
  return userId;
}
