import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { asUser, databaseMessage } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });

const addressSchema = z.object({
  label: z.enum(['Home', 'Work', 'Other']),
  recipient: z.string().trim().max(80),
  phone: z.string().trim().min(10).max(20),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200),
  landmark: z.string().trim().max(120),
  city: z.string().trim().max(80),
  pincode: z.string().trim().max(10),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  makeDefault: z.boolean()
});

const checkoutSchema = z.object({
  addressId: uuid,
  payOnline: z.boolean(),
  note: z.string().trim().max(500).default(''),
  shops: z
    .array(
      z.object({
        sellerId: uuid,
        lines: z.array(z.object({ productId: uuid, quantity: z.number().int().min(1).max(99) })).min(1).max(60)
      })
    )
    .min(1)
    .max(10)
});

const reviewSchema = z.object({
  shopRating: z.number().int().min(1).max(5).nullable(),
  items: z.array(z.object({ product_id: uuid, rating: z.number().int().min(1).max(5), body: z.string().max(500) })).max(60)
});

/**
 * Database errors raised by our own functions look like "CART_EMPTY" or
 * "INSUFFICIENT_STOCK:Paneer". Those are safe to pass on; the app turns the
 * code into a sentence. Anything else is an outage or a bug.
 */
const KNOWN = /^[A-Z][A-Z_]+(:.*)?$/s;
function asAppError(error: unknown): never {
  const message = databaseMessage(error);
  if (KNOWN.test(message)) throw new AppError(409, message, 'DATABASE_RULE');
  throw error;
}

const ADDRESS_SQL = `
  select id, label, recipient, phone, line1, line2, landmark, city, pincode, is_default,
         jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(st_x(location::geometry), st_y(location::geometry))) as location
  from addresses`;

export const customerRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Addresses ----------

  app.get('/addresses', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => ({
      addresses: await q.rows(`${ADDRESS_SQL} where user_id = $1 order by is_default desc, created_at desc`, [user.id])
    }));
  });

  app.post('/addresses', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const a = addressSchema.parse(request.body);

    return asUser(user.id, async (q) => {
      // Only one default per customer; the database enforces it, so clear the old one first.
      if (a.makeDefault) await q.rows('update addresses set is_default = false where user_id = $1 and is_default', [user.id]);

      const saved = await q.one(
        // RETURNING reads the new row directly; selecting it back in the same statement would not see it.
        `insert into addresses (user_id, label, recipient, phone, line1, line2, landmark, city, pincode, location, is_default)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, st_setsrid(st_makepoint($10, $11), 4326)::geography, $12)
         returning id, label, recipient, phone, line1, line2, landmark, city, pincode, is_default,
                   jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(st_x(location::geometry), st_y(location::geometry))) as location`,
        [user.id, a.label, a.recipient, a.phone, a.line1, a.line2, a.landmark, a.city, a.pincode, a.lng, a.lat, a.makeDefault]
      );
      return { address: saved };
    });
  });

  // ---------- Checkout ----------

  /**
   * Places one order per shop. Each shop is its own transaction, so one shop
   * failing (out of stock, closed, too far) never undoes the others. Prices are
   * never taken from the caller: place_order reads them from the database.
   */
  app.post('/checkout', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const input = checkoutSchema.parse(request.body);

    const placed: string[] = [];
    const failed: Array<{ sellerId: string; message: string }> = [];

    for (const shop of input.shops) {
      try {
        const orderId = await asUser(user.id, async (q) => {
          // place_order prices from its own cart table, so mirror this shop's lines into it.
          await q.rows('delete from cart_items where user_id = $1 and seller_id = $2', [user.id, shop.sellerId]);
          for (const line of shop.lines) {
            await q.rows(
              `insert into cart_items (user_id, product_id, seller_id, variant_id, quantity) values ($1, $2, $3, '', $4)`,
              [user.id, line.productId, shop.sellerId, line.quantity]
            );
          }
          const result = await q.one<{ id: string }>('select place_order($1, $2, $3, $4) as id', [
            input.addressId,
            shop.sellerId,
            input.payOnline,
            input.note
          ]);
          if (!result) throw new Error('ORDER_NOT_CREATED');
          return result.id;
        });
        placed.push(orderId);
      } catch (error) {
        // A product removed since it went into the cart breaks the cart link (foreign key 23503).
        const message = (error as { code?: string }).code === '23503' ? 'PRODUCT_UNAVAILABLE' : databaseMessage(error);
        // Keep going so orders already placed are still reported to the customer.
        if (!KNOWN.test(message)) request.log.error(error);
        failed.push({ sellerId: shop.sellerId, message: KNOWN.test(message) ? message : 'SERVER_ERROR' });
      }
    }

    return { placed, failed };
  });

  // ---------- Orders ----------

  app.get('/orders', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => ({
      orders: await q.rows(
        `select o.id, o.order_code, o.status, o.total_paise, o.created_at,
                jsonb_build_object('shop_name', s.shop_name) as seller,
                coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity))
                          from order_items i where i.order_id = o.id), '[]'::jsonb) as order_items
         from orders o left join sellers s on s.id = o.seller_id
         where o.customer_id = $1
         order by o.created_at desc
         limit 50`,
        [user.id]
      )
    }));
  });

  app.get('/orders/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);

    return asUser(user.id, async (q) => {
      // Ownership is checked here and again by row level security.
      const order = await q.one(
        `select o.id, o.order_code, o.status, o.payment_mode, o.required_online_paise, o.verified_prepaid_paise,
                o.subtotal_paise, o.delivery_fee_paise, o.platform_fee_paise, o.total_paise, o.delivery_address,
                o.distance_km, o.customer_note, o.accepted_at, o.delivered_at,
                o.cancel_reason, o.created_at,
                jsonb_build_object('id', s.id, 'shop_name', s.shop_name, 'phone', s.phone,
                                   'eta_minutes', s.eta_minutes, 'upi_id', s.upi_id, 'address', s.address) as seller
         from orders o left join sellers s on s.id = o.seller_id
         where o.id = $1 and o.customer_id = $2`,
        [id, user.id]
      );
      if (!order) throw new AppError(404, 'Order not found.');

      const [items, events, map, code, reviews] = await Promise.all([
        q.rows(
          `select id, product_id, name, variant_label, quantity, unit_price_paise, line_total_paise
           from order_items where order_id = $1`,
          [id]
        ),
        q.rows('select status, created_at, note from order_events where order_id = $1 order by created_at', [id]),
        q.one('select * from order_map($1)', [id]),
        q.one<{ code: string | null }>('select order_delivery_code($1) as code', [id]),
        q.rows('select product_id, rating from reviews where order_id = $1', [id])
      ]);

      return { order, items, events, map, code: code?.code ?? null, reviews };
    });
  });

  app.post('/orders/:id/cancel', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    try {
      await asUser(user.id, (q) => q.rows('select cancel_order($1, $2)', [id, 'Cancelled by customer']));
    } catch (error) {
      asAppError(error);
    }
    return { ok: true };
  });

  /** "Something went wrong with this order": reaches the shop and the admins. */
  app.post('/orders/:id/issue', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { kind, message } = z
      .object({
        kind: z.enum(['missing_item', 'wrong_item', 'quality', 'late', 'not_delivered', 'payment', 'other']),
        message: z.string().trim().max(500).default('')
      })
      .parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select report_order_issue($1, $2, $3)', [id, kind, message]));
    } catch (error) {
      asAppError(error);
    }
    return { ok: true };
  });

  app.get('/orders/:id/issues', async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    return asUser(user.id, async (q) => ({ issues: await q.rows('select * from my_order_issues($1)', [id]) }));
  });

  app.post('/orders/:id/claim-payment', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { reference } = z.object({ reference: z.string().trim().max(100).default('') }).parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select claim_payment($1, $2)', [id, reference]));
    } catch (error) {
      asAppError(error);
    }
    return { ok: true };
  });

  app.post('/orders/:id/review', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const review = reviewSchema.parse(request.body);
    try {
      await asUser(user.id, (q) =>
        q.rows('select submit_review($1, $2, $3, $4::jsonb)', [id, review.shopRating, '', JSON.stringify(review.items)])
      );
    } catch (error) {
      asAppError(error);
    }
    return { ok: true };
  });

  // ---------- Which shops can take online payment ----------

  app.get('/shops/online', async (request) => {
    const user = await requireUser(request);
    const { ids } = z
      .object({ ids: z.string().transform((value) => value.split(',').filter(Boolean)).pipe(z.array(uuid).max(50)) })
      .parse(request.query);
    return asUser(user.id, async (q) => ({
      ready: (await q.rows<{ id: string }>('select shops_accepting_online($1::uuid[]) as id', [ids])).map((row) => row.id)
    }));
  });
};
