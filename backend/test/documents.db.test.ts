import { describe, expect, it } from 'vitest';
import { asAnon, asService, asUser } from '../src/lib/db.js';
import { addFssai, HAS_DB, makeAdmin, makeCustomer, makeShop, placeOrder } from './db/helpers.js';

const sql = (userId: string, text: string, values: unknown[] = []) => asUser(userId, (q) => q.rows(text, values));
const submit = (userId: string, sellerId: string, kind = 'fssai', number = '12345678901234', days = 400, file?: string) =>
  sql(userId, `select submit_seller_document($1, $2, current_date + $3::int, $4)`, [kind, number, days, file ?? `${sellerId}/${kind}-x.pdf`]);
const docStatus = (sellerId: string, kind = 'fssai') =>
  asService((q) => q.one<{ status: string }>('select status from seller_documents where seller_id = $1 and kind = $2', [sellerId, kind])).then((r) => r?.status ?? null);
const discoverable = (sellerId: string) =>
  asAnon((q) => q.rows<{ id: string }>('select id from nearby_sellers(17.3855, 78.4880, 5, null, false, null, 1000, 0)')).then((rows) => rows.some((row) => row.id === sellerId));

describe.skipIf(!HAS_DB)('FSSAI and GST documents (database)', () => {
  it('lets the owner send a document and shows it as waiting for review', async () => {
    const shop = await makeShop({ fssai: false });
    await submit(shop.userId, shop.sellerId);
    const mine = await sql(shop.userId, 'select kind, number, status from my_seller_documents()');
    expect(mine).toEqual([{ kind: 'fssai', number: '12345678901234', status: 'pending' }]);
  });

  it('sends a changed document back for review', async () => {
    const shop = await makeShop({ fssai: false });
    const admin = await makeAdmin();
    await submit(shop.userId, shop.sellerId);
    await sql(admin, `select review_seller_document($1, 'fssai', true, '')`, [shop.sellerId]);
    expect(await docStatus(shop.sellerId)).toBe('approved');

    await submit(shop.userId, shop.sellerId, 'fssai', '98765432109876');
    expect(await docStatus(shop.sellerId)).toBe('pending');
  });

  it('refuses a file outside the shop’s own folder, an expired licence, an unknown kind and a non-shop', async () => {
    const shop = await makeShop({ fssai: false });
    const other = await makeShop({ fssai: false });
    await expect(submit(shop.userId, shop.sellerId, 'fssai', '12345678901234', 400, `${other.sellerId}/fssai-theirs.pdf`)).rejects.toThrow(/INVALID_FILE/);
    await expect(submit(shop.userId, shop.sellerId, 'fssai', '12345678901234', -1)).rejects.toThrow(/DOCUMENT_EXPIRED/);
    await expect(submit(shop.userId, shop.sellerId, 'passport')).rejects.toThrow(/UNKNOWN_DOCUMENT/);
    const customer = await makeCustomer();
    await expect(submit(customer.userId, shop.sellerId)).rejects.toThrow(/SELLER_PROFILE_REQUIRED/);
  });

  it('keeps a malformed number out of the table even if a caller skips the API checks', async () => {
    const shop = await makeShop({ fssai: false });
    await expect(submit(shop.userId, shop.sellerId, 'fssai', '1234567')).rejects.toThrow(/seller_documents_fssai_format/);
    await expect(submit(shop.userId, shop.sellerId, 'gst', 'NOTAGSTIN')).rejects.toThrow(/seller_documents_gst_format/);
  });

  it('keeps documents private: no direct reads, no reading another shop’s, admin only for review', async () => {
    const a = await makeShop({ fssai: false });
    const b = await makeShop({ fssai: false });
    await submit(a.userId, a.sellerId);
    await expect(sql(a.userId, 'select * from seller_documents')).rejects.toThrow(/permission denied/);
    expect(await sql(b.userId, 'select * from my_seller_documents()')).toHaveLength(0);
    await expect(sql(a.userId, 'select * from admin_seller_documents($1)', [a.sellerId])).rejects.toThrow(/ADMIN_ONLY/);
    await expect(sql(a.userId, `select review_seller_document($1, 'fssai', true, '')`, [a.sellerId])).rejects.toThrow(/ADMIN_ONLY/);
    expect(await docStatus(a.sellerId)).toBe('pending');
  });

  it('lists, for the admin, live shops that have a document waiting, and only them', async () => {
    const live = await makeShop({ fssai: false });
    const applicant = await makeShop({ approved: false, fssai: false });
    const admin = await makeAdmin();
    await submit(live.userId, live.sellerId);
    await submit(applicant.userId, applicant.sellerId);
    const waiting = await sql(admin, 'select seller_id from admin_pending_documents()');
    expect(waiting.map((row: any) => row.seller_id)).toContain(live.sellerId);
    expect(waiting.map((row: any) => row.seller_id)).not.toContain(applicant.sellerId);
    await expect(sql(live.userId, 'select * from admin_pending_documents()')).rejects.toThrow(/ADMIN_ONLY/);

    await sql(admin, `select review_seller_document($1, 'fssai', true, '')`, [live.sellerId]);
    const after = await sql(admin, 'select seller_id from admin_pending_documents()');
    expect(after.map((row: any) => row.seller_id)).not.toContain(live.sellerId);
  });

  it('lets an admin review and tells the owner', async () => {
    const shop = await makeShop({ fssai: false });
    const admin = await makeAdmin();
    await submit(shop.userId, shop.sellerId);
    await sql(admin, `select review_seller_document($1, 'fssai', false, 'The photo is blurred')`, [shop.sellerId]);
    expect(await docStatus(shop.sellerId)).toBe('rejected');
    const notes = await asService((q) => q.rows<{ title: string; body: string }>('select title, body from notifications where user_id = $1', [shop.userId]));
    expect(notes.some((n) => n.title === 'FSSAI document needs a fix' && n.body === 'The photo is blurred')).toBe(true);
    const files = await sql(admin, 'select file_path from admin_seller_documents($1)', [shop.sellerId]);
    expect(files).toHaveLength(1);
  });
});

describe.skipIf(!HAS_DB)('approving a shop needs the licence (database)', () => {
  const approve = (admin: string, sellerId: string) => sql(admin, `select review_seller($1, true, '')`, [sellerId]);

  it('will not approve a food shop without a reviewed FSSAI licence', async () => {
    const shop = await makeShop({ approved: false, fssai: false });
    const admin = await makeAdmin();
    await expect(approve(admin, shop.sellerId)).rejects.toThrow(/FSSAI_REQUIRED/);

    // A document that is only waiting for review is not enough.
    await submit(shop.userId, shop.sellerId);
    await expect(approve(admin, shop.sellerId)).rejects.toThrow(/FSSAI_REQUIRED/);

    await sql(admin, `select review_seller_document($1, 'fssai', true, '')`, [shop.sellerId]);
    await approve(admin, shop.sellerId);
    const row = await asService((q) => q.one<{ status: string }>('select status from sellers where id = $1', [shop.sellerId]));
    expect(row!.status).toBe('approved');
  });

  it('will not approve on a licence that has already expired', async () => {
    const shop = await makeShop({ approved: false, fssai: false });
    const admin = await makeAdmin();
    await addFssai(shop.sellerId, -2);
    await expect(approve(admin, shop.sellerId)).rejects.toThrow(/FSSAI_REQUIRED/);
  });

  it('still lets an admin decline a food shop without a licence', async () => {
    const shop = await makeShop({ approved: false, fssai: false });
    const admin = await makeAdmin();
    await sql(admin, `select review_seller($1, false, 'Please add your licence')`, [shop.sellerId]);
    const row = await asService((q) => q.one<{ status: string }>('select status from sellers where id = $1', [shop.sellerId]));
    expect(row!.status).toBe('rejected');
  });

  it('does not ask a shop that sells everyday items for an FSSAI licence', async () => {
    const shop = await makeShop({ approved: false, fssai: false });
    await asService((q) => q.rows(`update sellers set listing_mode = 'items' where id = $1`, [shop.sellerId]));
    const admin = await makeAdmin();
    await approve(admin, shop.sellerId);
    expect(await discoverable(shop.sellerId)).toBe(true);
  });

  it('can be switched off for everyone with compliance_enforced', async () => {
    const shop = await makeShop({ approved: false, fssai: false });
    const admin = await makeAdmin();
    try {
      await asService((q) => q.rows('update platform_settings set compliance_enforced = false'));
      await approve(admin, shop.sellerId);
    } finally {
      await asService((q) => q.rows('update platform_settings set compliance_enforced = true'));
    }
  });
});

describe.skipIf(!HAS_DB)('a licence decides whether a food shop can trade (database)', () => {
  it('hides a shop whose licence has expired and refuses new orders, but finishes existing ones', async () => {
    const shop = await makeShop();
    const customer = await makeCustomer();
    const existing = await placeOrder(customer, shop);
    expect(await discoverable(shop.sellerId)).toBe(true);

    await addFssai(shop.sellerId, -1);

    expect(await discoverable(shop.sellerId)).toBe(false);
    await expect(placeOrder(customer, shop)).rejects.toThrow(/SELLER_NOT_ACCEPTING_ORDERS/);
    await sql(shop.userId, 'select seller_decide_order($1, true)', [existing]);
  });

  it('hides a shop whose licence was rejected, and brings it back when approved again', async () => {
    const shop = await makeShop();
    await addFssai(shop.sellerId, 365, 'rejected');
    expect(await discoverable(shop.sellerId)).toBe(false);
    await addFssai(shop.sellerId, 365, 'approved');
    expect(await discoverable(shop.sellerId)).toBe(true);
  });

  it('gives a shop that was live before the rule its 30 days, then hides it', async () => {
    const shop = await makeShop({ fssai: false });
    expect(await discoverable(shop.sellerId)).toBe(false);
    await asService((q) => q.rows(`update sellers set documents_due_at = now() + interval '5 days' where id = $1`, [shop.sellerId]));
    expect(await discoverable(shop.sellerId)).toBe(true);
    await asService((q) => q.rows(`update sellers set documents_due_at = now() - interval '1 minute' where id = $1`, [shop.sellerId]));
    expect(await discoverable(shop.sellerId)).toBe(false);
  });

  it('shows only a reviewed, unexpired FSSAI number to customers', async () => {
    const shop = await makeShop({ fssai: false });
    const licences = () =>
      asAnon((q) => q.rows<{ seller_id: string; fssai_number: string }>('select * from seller_licences($1::uuid[])', [[shop.sellerId]]));
    expect(await licences()).toHaveLength(0);
    await addFssai(shop.sellerId, 365, 'pending');
    expect(await licences()).toHaveLength(0);
    await addFssai(shop.sellerId, 365, 'approved');
    expect(await licences()).toEqual([{ seller_id: shop.sellerId, fssai_number: '12345678901234' }]);
    await addFssai(shop.sellerId, -1, 'approved');
    expect(await licences()).toHaveLength(0);
  });
});

describe.skipIf(!HAS_DB)('licence reminders (database)', () => {
  const titles = (userId: string) =>
    asService((q) => q.rows<{ title: string }>('select title from notifications where user_id = $1 order by created_at', [userId])).then((rows) => rows.map((r) => r.title));

  it('warns before expiry and after, once each', async () => {
    const soon = await makeShop();
    const gone = await makeShop();
    await addFssai(soon.sellerId, 5);
    await addFssai(gone.sellerId, -3);
    await asService((q) => q.rows('select compliance_reminders()'));
    await asService((q) => q.rows('select compliance_reminders()'));
    expect(await titles(soon.userId)).toEqual(['Your FSSAI licence expires soon']);
    expect(await titles(gone.userId)).toEqual(['Your FSSAI licence has expired']);
  });

  it('nudges a shop that has not added its licence yet, and says so when the time is up', async () => {
    const waiting = await makeShop({ fssai: false });
    const late = await makeShop({ fssai: false });
    await asService((q) => q.rows(`update sellers set documents_due_at = now() + interval '10 days' where id = $1`, [waiting.sellerId]));
    await asService((q) => q.rows(`update sellers set documents_due_at = now() - interval '1 day' where id = $1`, [late.sellerId]));
    await asService((q) => q.rows('select compliance_reminders()'));
    expect(await titles(waiting.userId)).toEqual(['Add your FSSAI licence']);
    expect(await titles(late.userId)).toEqual(['Your shop is hidden: FSSAI licence needed']);
  });

  it('leaves a compliant shop alone', async () => {
    const shop = await makeShop();
    await asService((q) => q.rows('select compliance_reminders()'));
    expect(await titles(shop.userId)).toEqual([]);
  });
});
