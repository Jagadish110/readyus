import { randomInt, randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { requireUser } from '../lib/auth.js';
import { asUser, databaseMessage, type Q } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { supabase } from '../lib/supabase.js';

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });

const BUCKET = 'product-images';
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const SHOP_SQL = `select id, shop_name, listing_mode, status, public_visible, review_note, business_open, auto_accept,
                         service_radius_km, open_time, close_time
                  from sellers`;

const PRODUCT_SQL = `select id, name, description, category_key, listing_mode, price, mrp, unit, stock, images,
                            veg_type, spice_level, prep_minutes, available, approval_status, review_note,
                            rating, rating_count
                     from products`;

type Shop = { id: string; status: string; listing_mode: 'food' | 'items' };

/** The caller's own shop. Everything a seller route touches is scoped to this id. */
async function ownShop(q: Q, userId: string): Promise<Shop> {
  const shop = await q.one<Shop>('select id, status, listing_mode from sellers where user_id = $1', [userId]);
  if (!shop) throw new AppError(404, 'Create your shop first.', 'NO_SHOP');
  return shop;
}

const KNOWN = /^[A-Z][A-Z_]+(:.*)?$/s;
function ruleError(error: unknown): never {
  const message = databaseMessage(error);
  if (KNOWN.test(message)) throw new AppError(409, message, 'DATABASE_RULE');
  throw error;
}

/** Product photos must be ones this shop uploaded through us, never arbitrary links. */
const imageUrl = (shopId: string) =>
  z
    .string()
    .url()
    .refine((value) => value.startsWith(`${config.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${shopId}/`), {
      message: 'Photos must be uploaded through Localty.'
    });

const productFields = (shopId: string) =>
  z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000),
    category_key: z.string().trim().min(1).max(60),
    listing_mode: z.enum(['food', 'items']),
    price: z.number().min(0).max(1_000_000),
    mrp: z.number().min(0).max(1_000_000).nullable(),
    unit: z.string().trim().max(40),
    stock: z.number().int().min(0).max(100_000),
    images: z.array(imageUrl(shopId)).max(4),
    veg_type: z.string().trim().max(20),
    spice_level: z.string().trim().max(20),
    prep_minutes: z.number().int().min(0).max(600).nullable()
  });

const settingsSchema = z
  .object({
    business_open: z.boolean(),
    auto_accept: z.boolean(),
    service_radius_km: z.number().min(0.5).max(50),
    open_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    close_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/)
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to save.');

const applySchema = z.object({
  shopName: z.string().trim().min(2).max(100),
  ownerName: z.string().trim().min(2).max(100),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid mobile number.'),
  category: z.string().trim().min(1).max(60),
  listingMode: z.enum(['food', 'items']),
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(1).max(80),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit pincode.'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

// No I, O, 0 or 1, so a code read aloud is hard to mistake.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export const sellerConsoleRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Shop ----------

  app.get('/me', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => ({ shop: await q.one(`${SHOP_SQL} where user_id = $1`, [user.id]) }));
  });

  /** The application status for the apply page (works before a shop is approved). */
  app.get('/application', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => ({
      application: await q.one('select shop_name, status, review_note from sellers where user_id = $1', [user.id])
    }));
  });

  app.post('/shop/settings', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const values = settingsSchema.parse(request.body);

    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      const entries = Object.entries(values);
      // Column names come from the schema above, never from the request.
      const sets = entries.map(([column], index) => `${column} = $${index + 2}`).join(', ');
      await q.rows(`update sellers set ${sets} where id = $1`, [shop.id, ...entries.map(([, value]) => value)]);
      return { ok: true };
    });
  });

  app.post('/apply', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const a = applySchema.parse(request.body);

    return asUser(user.id, async (q) => {
      try {
        const applied = await q.one<{ id: string }>('select apply_to_sell($1, $2, $3, $4, $5::listing_mode, $6, $7, $8) as id', [
          a.shopName,
          a.ownerName,
          a.phone,
          a.category,
          a.listingMode,
          a.address,
          a.city,
          a.pincode
        ]);
        if (!applied) throw new Error('APPLICATION_NOT_SAVED');

        // A shop without a pin never appears to customers, so it is saved with the application.
        await q.rows(
          'update sellers set location = st_setsrid(st_makepoint($2, $3), 4326)::geography where id = $1 and user_id = $4',
          [applied.id, a.lng, a.lat, user.id]
        );
        return { sellerId: applied.id };
      } catch (error) {
        return ruleError(error);
      }
    });
  });

  // ---------- Photos ----------

  /**
   * Hands the browser a one-time upload link into this shop's own folder. The
   * file goes straight to storage, but only to a path this server chose.
   */
  app.post('/uploads', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { kind, contentType } = z
      .object({ kind: z.enum(['product', 'shop']), contentType: z.string() })
      .parse(request.body);

    const extension = IMAGE_TYPES[contentType];
    if (!extension) throw new AppError(400, 'Photos must be JPG, PNG or WebP.');

    const shop = await asUser(user.id, (q) => ownShop(q, user.id));
    const path = `${shop.id}/${kind === 'shop' ? 'shop-' : ''}${randomUUID()}.${extension}`;

    const signed = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data) throw signed.error ?? new Error('Could not create an upload link.');

    return {
      uploadUrl: signed.data.signedUrl,
      publicUrl: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    };
  });

  app.post('/shop/photo', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const body = z.object({ url: z.string().url() }).parse(request.body);

    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      imageUrl(shop.id).parse(body.url);
      await q.rows('update sellers set photo_url = $2, banner_url = $2 where id = $1', [shop.id, body.url]);
      return { ok: true };
    });
  });

  // ---------- Products ----------

  app.get('/products', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      return { products: await q.rows(`${PRODUCT_SQL} where seller_id = $1 order by created_at desc`, [shop.id]) };
    });
  });

  app.get('/products/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      // Scoped to this shop, so another seller's id is simply "not found".
      const product = await q.one(`${PRODUCT_SQL} where id = $1 and seller_id = $2`, [id, shop.id]);
      if (!product) throw new AppError(404, 'Product not found.');
      return { product };
    });
  });

  app.post('/products', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      const p = productFields(shop.id).parse(request.body);
      // New rows are approved by the column default (migration 0013); sellers have no grant on that column.
      const created = await q.one<{ id: string }>(
        `insert into products (seller_id, name, description, category_key, listing_mode, price, mrp, unit, stock,
                               images, veg_type, spice_level, prep_minutes, available)
         values ($1, $2, $3, $4, $5::listing_mode, $6, $7, $8, $9, $10, $11, $12, $13, true)
         returning id`,
        [shop.id, p.name, p.description, p.category_key, p.listing_mode, p.price, p.mrp, p.unit, p.stock, p.images, p.veg_type, p.spice_level, p.prep_minutes]
      );
      return { id: created?.id };
    });
  });

  app.post('/products/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      const p = productFields(shop.id).parse(request.body);
      const updated = await q.rows(
        `update products set name = $3, description = $4, category_key = $5, listing_mode = $6::listing_mode, price = $7,
                mrp = $8, unit = $9, stock = $10, images = $11, veg_type = $12, spice_level = $13,
                prep_minutes = $14, available = true
         where id = $1 and seller_id = $2
         returning id`,
        [id, shop.id, p.name, p.description, p.category_key, p.listing_mode, p.price, p.mrp, p.unit, p.stock, p.images, p.veg_type, p.spice_level, p.prep_minutes]
      );
      if (!updated.length) throw new AppError(404, 'Product not found.');
      return { ok: true };
    });
  });

  app.post('/products/:id/stock', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { inStock } = z.object({ inStock: z.boolean() }).parse(request.body);
    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      const updated = await q.rows('update products set stock = $3, available = true where id = $1 and seller_id = $2 returning id', [
        id,
        shop.id,
        inStock ? 999 : 0
      ]);
      if (!updated.length) throw new AppError(404, 'Product not found.');
      return { ok: true };
    });
  });

  // ---------- Orders ----------

  app.get('/orders', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      return {
        orders: await q.rows(
          `select o.id, o.order_code, o.status, o.total_paise, o.payment_mode, o.required_online_paise,
                  o.created_at, o.customer_note, o.verified_prepaid_paise, o.refunded_paise, o.refund_target_paise, o.accept_deadline_at,
                  -- Only what the shop needs to hand the order over.
                  jsonb_build_object('recipient', o.delivery_address -> 'recipient',
                                     'line1', o.delivery_address -> 'line1',
                                     'city', o.delivery_address -> 'city') as delivery_address,
                  coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity))
                            from order_items i where i.order_id = o.id), '[]'::jsonb) as order_items,
                  -- Who is delivering it, once the shop has chosen.
                  (select jsonb_build_object('agent_id', da.agent_id, 'status', da.status,
                                             'name', a.full_name, 'phone', a.phone)
                   from delivery_assignments da join delivery_agents a on a.id = da.agent_id
                   where da.order_id = o.id) as delivery
           from orders o where o.seller_id = $1
           order by o.created_at desc limit 60`,
          [shop.id]
        )
      };
    });
  });

  /** Order and money lines for the Payouts page. */
  app.get('/payout-orders', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      return {
        orders: await q.rows(
          `select id, order_code, status, verified_prepaid_paise, refunded_paise, created_at
           from orders where seller_id = $1 order by created_at desc`,
          [shop.id]
        )
      };
    });
  });

  const decision = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  app.post('/orders/:id/decide', decision, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { accept, reason } = z.object({ accept: z.boolean(), reason: z.string().trim().max(200).default('') }).parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select seller_decide_order($1, $2, $3)', [id, accept, reason]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  app.post('/orders/:id/verify-payment', decision, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { accept } = z.object({ accept: z.boolean() }).parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select verify_payment($1, $2)', [id, accept]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  /** The shop picks who delivers a packed order, and may change the rider until it is picked up. */
  app.post('/orders/:id/assign', decision, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { agentId } = z.object({ agentId: uuid }).parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select assign_delivery($1, $2)', [id, agentId]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  /** The shop cannot make an order it accepted. Stock goes back; an online payment is refunded; the rider is freed. */
  app.post('/orders/:id/cancel', decision, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { reason } = z.object({ reason: z.string().trim().max(200).default('') }).parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select seller_cancel_order($1, $2)', [id, reason]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  /** Nobody could hand the order over. Fault of the shop or rider refunds it; the customer's fault does not. */
  app.post('/orders/:id/delivery-failed', decision, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { cause, note } = z
      .object({
        cause: z.enum(['customer_unreachable', 'customer_refused', 'wrong_address', 'rider_problem', 'shop_problem']),
        note: z.string().trim().max(200).default('')
      })
      .parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select report_delivery_failed($1, $2, $3)', [id, cause, note]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  /** Returns all or part of an online payment (for example a missing item). The refund job pays it out. */
  app.post('/orders/:id/refund', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { amountPaise, reason } = z
      .object({ amountPaise: z.number().int().min(1).max(10_000_000), reason: z.string().trim().max(200).default('') })
      .parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select seller_request_refund($1, $2, $3)', [id, amountPaise, reason]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  // ---------- Cash the riders are holding ----------

  app.get('/cash', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => ({ rows: await q.rows('select * from cash_with_riders()') }));
  });

  app.post('/cash/confirm', decision, async (request) => {
    const user = await requireUser(request);
    const { agentId, orderId } = z.object({ agentId: uuid, orderId: uuid.optional() }).parse(request.body);
    return asUser(user.id, async (q) => {
      const row = await q.one<{ n: number }>('select confirm_cash_handover($1, $2) as n', [agentId, orderId ?? null]);
      return { ok: true, confirmed: row?.n ?? 0 };
    });
  });

  // ---------- Problems customers reported ----------

  app.get('/issues', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => ({ issues: await q.rows('select * from seller_order_issues()') }));
  });

  app.post('/issues/:id/resolve', decision, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { note } = z.object({ note: z.string().trim().max(500).default('') }).parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select resolve_order_issue($1, $2)', [id, note]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  app.post('/orders/:id/stage', decision, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { stage } = z.object({ stage: z.enum(['preparing', 'packed']) }).parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select seller_set_stage($1, $2::order_status)', [id, stage]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  // ---------- Delivery team ----------

  app.get('/fleet', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      const [partners, invites] = await Promise.all([
        q.rows(
          `select r.id, r.agent_id, jsonb_build_object('full_name', a.full_name, 'phone', a.phone, 'vehicle', a.vehicle) as agent
           from delivery_relationships r left join delivery_agents a on a.id = r.agent_id
           where r.seller_id = $1 and r.active`,
          [shop.id]
        ),
        q.rows(
          `select id, code, expires_at, used_at from delivery_invites
           where seller_id = $1 order by created_at desc limit 10`,
          [shop.id]
        )
      ]);
      return { partners, invites };
    });
  });

  app.post('/fleet/invites', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const shop = await ownShop(q, user.id);
      // The server picks the code, so it cannot be chosen or guessed by the browser.
      await q.rows(`insert into delivery_invites (seller_id, code, expires_at) values ($1, $2, now() + interval '7 days')`, [
        shop.id,
        newCode()
      ]);
      return { ok: true };
    });
  });

  // ---------- Categories ----------

  app.get('/categories', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => ({
      categories: await q.rows('select mode, key, name from categories where enabled order by sort')
    }));
  });
};
