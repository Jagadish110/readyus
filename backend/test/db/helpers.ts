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
export async function makeShop(opts: { approved?: boolean; stock?: number; fssai?: boolean } = {}) {
  const userId = await makeUser('owner');
  const sellerId = await asService(async (q) => {
    const seller = await q.one<{ id: string }>(
      // Equal opening and closing times mean "open all day", so tests never depend on the time they run at.
      `insert into sellers (user_id, shop_name, owner_name, phone, status, public_visible, location, business_open, open_time, close_time)
       values ($1, 'Test Kitchen', 'Owner', '9876543210', $2, $3, ${point(SHOP_AT)}, true, '00:00', '00:00') returning id`,
      [userId, opts.approved === false ? 'pending' : 'approved', opts.approved !== false]
    );
    return seller!.id;
  });
  // Food shops need a reviewed FSSAI licence to trade; by default the test shop has one.
  if (opts.fssai !== false) await addFssai(sellerId);
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
    q.rows('insert into cart_items (user_id, product_id, seller_id, quantity) values ($1, $2, $3, $4) on conflict (user_id, product_id, variant_id) do update set quantity = excluded.quantity', [
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

/** The delivery profile id of a rider's user (what a shop assigns an order to). */
export const agentOf = (userId: string) =>
  asService((q) => q.one<{ id: string }>('select id from delivery_agents where user_id = $1', [userId])).then((row) => row!.id);

/** An approved FSSAI document, valid for a year unless told otherwise. */
export async function addFssai(sellerId: string, validDays = 365, status: 'approved' | 'pending' | 'rejected' = 'approved') {
  await asService((q) =>
    q.rows(
      `insert into seller_documents (seller_id, kind, number, valid_until, file_path, status)
       values ($1, 'fssai', '12345678901234', current_date + $2::int, $3, $4)
       on conflict (seller_id, kind) do update set valid_until = excluded.valid_until, status = excluded.status`,
      [sellerId, validDays, `${sellerId}/fssai-test.pdf`, status]
    )
  );
}

export async function makeAdmin() {
  const id = await makeUser('admin');
  await asService((q) => q.rows(`insert into user_roles (user_id, role) values ($1, 'admin') on conflict do nothing`, [id]));
  return id;
}

/** An order the shop has accepted, prepared and packed; optionally paid online first. */
export async function packedOrder(opts: { online?: boolean; quantity?: number } = {}) {
  const shop = await makeShop();
  const customer = await makeCustomer();
  const orderId = await placeOrder(customer, shop, { online: opts.online, quantity: opts.quantity });
  if (opts.online) await payOnline(orderId);
  await asUser(shop.userId, (q) => q.rows('select seller_decide_order($1, true)', [orderId]));
  await asUser(shop.userId, (q) => q.rows(`select seller_set_stage($1, 'preparing')`, [orderId]));
  await asUser(shop.userId, (q) => q.rows(`select seller_set_stage($1, 'packed')`, [orderId]));
  return { shop, customer, orderId };
}

/** Records a verified Cashfree payment for the order, as the webhook would. */
export async function payOnline(orderId: string, amountPaise?: number) {
  await asService(async (q) => {
    const order = await q.one<{ required_online_paise: number; seller_id: string }>('select required_online_paise, seller_id from orders where id = $1', [orderId]);
    const cf = 'cf_' + orderId.slice(0, 10);
    await q.rows('update orders set cashfree_order_id = $2 where id = $1', [orderId, cf]);
    await q.rows('select mark_order_paid($1, $2, $3)', [cf, 'pay_' + orderId.slice(0, 10), amountPaise ?? order!.required_online_paise]);
    await q.rows(
      `insert into seller_payout_accounts (seller_id, cashfree_vendor_id, status) values ($1, $2, 'activated') on conflict (seller_id) do nothing`,
      [order!.seller_id, 'shop_' + order!.seller_id.slice(0, 8)]
    );
  });
}

/** Gives the packed order to a new rider on the shop's team and returns the rider's user id. */
export async function assignRider(shop: { userId: string; sellerId: string }, orderId: string) {
  const rider = await makeRider(shop.sellerId);
  const agent = await agentOf(rider);
  await asUser(shop.userId, (q) => q.rows('select assign_delivery($1, $2)', [orderId, agent]));
  return rider;
}
