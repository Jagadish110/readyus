import { describe, expect, it } from 'vitest';
import { asService, asUser } from '../src/lib/db.js';
import { agentOf, HAS_DB, makeAdmin, makeCustomer, makeRider, makeShop, packedOrder, payOnline, placeOrder, makeUser } from './db/helpers.js';

const sql = <T = Record<string, unknown>>(userId: string, text: string, values: unknown[] = []) =>
  asUser(userId, (q) => q.rows<T>(text, values));
const canTrade = (sellerId: string) =>
  asService((q) => q.one<{ ok: boolean }>('select shop_can_trade($1) as ok', [sellerId])).then((r) => r!.ok);
const visibleShops = (userId: string) =>
  sql<{ id: string }>(userId, 'select id from nearby_sellers(17.385, 78.4867, 5, null, false, null, 1000, 0)').then((rows) => rows.map((r) => r.id));

describe.skipIf(!HAS_DB)('admin console (database)', () => {
  it('is closed to everyone who is not an admin', async () => {
    const { userId } = await makeShop();
    for (const call of ['admin_overview()', "admin_shops('', 10)", "admin_riders('', 10)", "admin_orders('', '', 10)", "admin_list_admins()"]) {
      await expect(sql(userId, `select * from ${call}`)).rejects.toThrow(/ADMIN_ONLY/);
    }
    await expect(sql(userId, "select admin_grant_admin('x@example.test')")).rejects.toThrow(/ADMIN_ONLY/);
  });

  it('suspending a shop hides it and stops orders; lifting it brings it back', async () => {
    const admin = await makeAdmin();
    const shop = await makeShop();
    const customer = await makeCustomer();
    expect(await canTrade(shop.sellerId)).toBe(true);
    expect(await visibleShops(customer.userId)).toContain(shop.sellerId);

    await expect(sql(admin, 'select admin_set_shop_suspended($1, true, $2)', [shop.sellerId, ''])).rejects.toThrow(/REASON_REQUIRED/);
    await sql(admin, 'select admin_set_shop_suspended($1, true, $2)', [shop.sellerId, 'Customer complaints under review']);

    expect(await canTrade(shop.sellerId)).toBe(false);
    expect(await visibleShops(customer.userId)).not.toContain(shop.sellerId);
    await expect(placeOrder(customer, shop)).rejects.toThrow();

    const note = await asService((q) =>
      q.one<{ body: string }>(`select body from notifications where user_id = $1 and title = 'Your shop is paused'`, [shop.userId])
    );
    expect(note?.body).toBe('Customer complaints under review');

    await sql(admin, 'select admin_set_shop_suspended($1, false)', [shop.sellerId]);
    expect(await canTrade(shop.sellerId)).toBe(true);
    const log = await asService((q) => q.rows<{ action: string }>(`select action from audit_logs where entity_id = $1 order by created_at`, [shop.sellerId]));
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['seller.suspend', 'seller.unsuspend']));
  });

  it('lists shops with their plan and licence state, and searches by name', async () => {
    const admin = await makeAdmin();
    const shop = await makeShop();
    const rows = await sql<{ id: string; fssai_status: string; can_trade: boolean }>(admin, "select * from admin_shops('Test Kitchen', 200)");
    const mine = rows.find((r) => r.id === shop.sellerId)!;
    expect(mine.fssai_status).toBe('approved');
    expect(mine.can_trade).toBe(true);
    expect(await sql(admin, "select * from admin_shops('no-such-shop-xyz', 10)")).toHaveLength(0);
  });

  it('suspends a rider who is idle, refuses one on a delivery, and blocks assignment', async () => {
    const admin = await makeAdmin();
    const { shop, orderId } = await packedOrder();
    const riderUser = await makeRider(shop.sellerId);
    const agent = await agentOf(riderUser);

    await sql(admin, 'select admin_set_rider_suspended($1, true, $2)', [agent, 'Misconduct']);
    await expect(sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, agent])).rejects.toThrow(/RIDER_NOT_IN_TEAM/);
    await expect(sql(admin, 'select admin_set_rider_suspended($1, true, $2)', [agent, 'Again'])).rejects.toThrow(/RIDER_NOT_FOUND/);

    await sql(admin, 'select admin_set_rider_suspended($1, false)', [agent]);
    await sql(shop.userId, 'select assign_delivery($1, $2)', [orderId, agent]);
    await expect(sql(admin, 'select admin_set_rider_suspended($1, true, $2)', [agent, 'Mid delivery'])).rejects.toThrow(/RIDER_HAS_ACTIVE_DELIVERY/);
  });

  it('finds an order and returns its full story', async () => {
    const admin = await makeAdmin();
    const { shop, customer, orderId } = await packedOrder({ online: true });
    const code = (await asService((q) => q.one<{ order_code: string }>('select order_code from orders where id = $1', [orderId])))!.order_code;

    const found = await sql<{ id: string; shop_name: string }>(admin, "select * from admin_orders($1, '', 10)", [code]);
    expect(found.map((o) => o.id)).toEqual([orderId]);

    await sql(customer.userId, "select report_order_issue($1, 'late', 'Very late')", [orderId]).catch(() => undefined);
    const detail = (await sql<{ admin_order_detail: any }>(admin, 'select admin_order_detail($1)', [orderId]))[0].admin_order_detail;
    expect(detail.order.shop_name).toBe('Test Kitchen');
    expect(detail.items.length).toBeGreaterThan(0);
    expect(detail.events.length).toBeGreaterThan(1);
    expect(shop.sellerId).toBeTruthy();
    await expect(sql(admin, 'select admin_order_detail($1)', ['00000000-0000-0000-0000-000000000000'])).rejects.toThrow(/ORDER_NOT_FOUND/);
  });

  it('refunds from the admin side and counts it in the overview', async () => {
    const admin = await makeAdmin();
    const { orderId } = await packedOrder({ online: true });
    const before = (await sql<{ admin_overview: any }>(admin, 'select admin_overview()'))[0].admin_overview;
    await sql(admin, 'select admin_request_refund($1, 2500, $2)', [orderId, 'Goodwill']);
    const after = (await sql<{ admin_overview: any }>(admin, 'select admin_overview()'))[0].admin_overview;
    expect(after.refunds_waiting).toBe(before.refunds_waiting + 1);
    expect(after.orders_today).toBeGreaterThan(0);
  });

  it('grants admin by email, never removes yourself, and keeps a trail', async () => {
    const admin = await makeAdmin();
    const person = await makeUser('colleague');
    const email = (await asService((q) => q.one<{ email: string }>('select email from auth.users where id = $1', [person])))!.email;
    await asService((q) => q.rows(`insert into profiles (id, email) values ($1, $2) on conflict (id) do update set email = excluded.email`, [person, email]));

    await expect(sql(admin, "select admin_grant_admin('nobody@example.test')")).rejects.toThrow(/ACCOUNT_NOT_FOUND/);
    await sql(admin, 'select admin_grant_admin($1)', [email.toUpperCase()]);
    const admins = await sql<{ user_id: string }>(admin, 'select * from admin_list_admins()');
    expect(admins.map((a) => a.user_id)).toContain(person);

    await expect(sql(admin, 'select admin_revoke_admin($1)', [admin])).rejects.toThrow(/CANNOT_REMOVE_SELF/);
    await sql(admin, 'select admin_revoke_admin($1)', [person]);
    await expect(sql(person, "select * from admin_overview()")).rejects.toThrow(/ADMIN_ONLY/);
    await expect(sql(admin, 'select admin_revoke_admin($1)', [person])).rejects.toThrow(/NOT_AN_ADMIN/);
  });
});
