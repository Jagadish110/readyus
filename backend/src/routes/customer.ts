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
        lines: z
          .array(
            z.object({
              productId: uuid,
              // A size or portion of the dish (see variantsField in seller-console.ts); '' for none.
              variantId: z.string().regex(/^[a-z0-9]{0,16}$/).default(''),
              // The shop's extras added to it, by id. place_order checks and prices them.
              extraIds: z.array(z.string().regex(/^[a-z0-9]{1,16}$/)).max(30).default([]),
              quantity: z.number().int().min(1).max(99)
            })
          )
          .min(1)
          .max(60)
      })
    )
    .min(1)
    .max(10)
});

// The same line shape checkout takes, so a saved cart and an order agree on what a line is.
const cartLineSchema = z.object({
  productId: uuid,
  variantId: z.string().regex(/^[a-z0-9]{0,16}$/).default(''),
  extraIds: z.array(z.string().regex(/^[a-z0-9]{1,16}$/)).max(30).default([]),
  quantity: z.number().int().min(1).max(99)
});
const cartSchema = z.object({ lines: z.array(cartLineSchema).max(100) });

/**
 * The signed-in customer's saved cart, priced now: the size's price plus each extra's price for that size
 * (extra_price, which place_order also uses). Lines whose dish was deleted are gone by foreign key.
 */
const CART_SQL = `
  select ci.product_id, ci.seller_id, ci.variant_id, ci.quantity,
         p.name, p.unit, p.price, p.mrp, p.veg_type, p.images[1] as image, s.shop_name,
         v.value as variant,
         coalesce((select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'label', x ->> 'label',
                                                       'price', public.extra_price(x, v.value ->> 'label'))
                                    order by x ->> 'id')
                   from jsonb_array_elements(s.extras) as x
                   where x ->> 'id' = any (ci.extra_ids)), '[]'::jsonb) as extras
  from cart_items ci
  join products p on p.id = ci.product_id
  join sellers s on s.id = ci.seller_id
  left join lateral (
    select value from jsonb_array_elements(p.variants) where value ->> 'id' = ci.variant_id and ci.variant_id <> '' limit 1
  ) v on true
  where ci.user_id = $1
  order by ci.created_at, ci.id`;

type CartRow = {
  product_id: string;
  seller_id: string;
  variant_id: string;
  quantity: number;
  name: string;
  unit: string;
  price: string;
  mrp: string | null;
  veg_type: string;
  image: string | null;
  shop_name: string;
  variant: { id: string; label: string; price: number; mrp?: number | null } | null;
  extras: Array<{ id: string; label: string; price: number | string }>;
};

/** A saved line in the shape the website's cart keeps (see CartLine in src/lib/state/cart.tsx). */
function cartLine(row: CartRow) {
  const extras = row.extras.map((extra) => ({ id: extra.id, label: extra.label, price: Number(extra.price) }));
  const base = row.variant ? Number(row.variant.price) : Number(row.price);
  return {
    productId: row.product_id,
    sellerId: row.seller_id,
    sellerName: row.shop_name,
    name: row.name,
    unit: row.variant ? row.variant.label : row.unit,
    price: base + extras.reduce((total, extra) => total + extra.price, 0),
    mrp: row.variant ? (row.variant.mrp ?? null) : row.mrp === null ? null : Number(row.mrp),
    vegType: row.veg_type,
    image: row.image,
    ...(row.variant ? { variantId: row.variant.id, variantLabel: row.variant.label } : {}),
    ...(extras.length ? { extras } : {}),
    quantity: row.quantity
  };
}

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

  /** Make an address the one used first at checkout. */
  app.post('/addresses/:id/default', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    return asUser(user.id, async (q) => {
      const mine = await q.one('select id from addresses where id = $1 and user_id = $2', [id, user.id]);
      if (!mine) throw new AppError(404, 'Address not found.');
      await q.rows('update addresses set is_default = false where user_id = $1 and is_default', [user.id]);
      await q.rows('update addresses set is_default = true where id = $1 and user_id = $2', [id, user.id]);
      return { ok: true };
    });
  });

  /** Removes a saved address. Orders already placed keep their own copy of where they went. */
  app.post('/addresses/:id/delete', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    return asUser(user.id, async (q) => {
      const gone = await q.one<{ is_default: boolean }>('delete from addresses where id = $1 and user_id = $2 returning is_default', [id, user.id]);
      if (!gone) throw new AppError(404, 'Address not found.');
      // Never leave someone with addresses and no default.
      if (gone.is_default) {
        await q.rows(
          `update addresses set is_default = true where id = (select id from addresses where user_id = $1 order by created_at desc limit 1)`,
          [user.id]
        );
      }
      return { ok: true };
    });
  });

  // ---------- Favourite shops ----------

  app.get('/favourites', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => ({
      shops: await q.rows(
        `select s.id, s.shop_name, s.category, s.listing_mode, s.city, s.photo_url, s.rating, s.rating_count,
                public.shop_can_trade(s.id) as available, public.shop_is_open_now(s.id) as is_open
         from favourite_sellers f join sellers s on s.id = f.seller_id
         where f.user_id = $1 and s.status = 'approved' and s.public_visible
         order by f.created_at desc limit 100`,
        [user.id]
      )
    }));
  });

  app.post('/favourites/shops/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { on } = z.object({ on: z.boolean() }).parse(request.body);
    return asUser(user.id, async (q) => {
      if (on) {
        const exists = await q.one(`select id from sellers where id = $1 and status = 'approved' and public_visible`, [id]);
        if (!exists) throw new AppError(404, 'Shop not found.');
        await q.rows('insert into favourite_sellers (user_id, seller_id) values ($1, $2) on conflict do nothing', [user.id, id]);
      } else {
        await q.rows('delete from favourite_sellers where user_id = $1 and seller_id = $2', [user.id, id]);
      }
      return { ok: true };
    });
  });

  // ---------- Saved cart ----------

  /** The cart follows the account, so the laptop and the phone show the same one. */
  app.get('/cart', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => ({ lines: (await q.rows<CartRow>(CART_SQL, [user.id])).map(cartLine) }));
  });

  /**
   * Replaces the saved cart with what the browser holds. Dishes that no longer exist, sizes the dish does
   * not have and extras it does not offer are dropped, so a stale tab cannot save a line checkout would refuse.
   */
  app.post('/cart', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { lines } = cartSchema.parse(request.body);

    return asUser(user.id, async (q) => {
      await q.rows('delete from cart_items where user_id = $1', [user.id]);
      for (const line of lines) {
        const extraIds = [...new Set(line.extraIds)].sort();
        await q.rows(
          `insert into cart_items (user_id, product_id, seller_id, variant_id, extra_ids, quantity)
           select $1, p.id, p.seller_id, $3, $4::text[], $5
           from products p
           where p.id = $2
             and ($3 = '' or exists (select 1 from jsonb_array_elements(p.variants) v where v ->> 'id' = $3))
             and $4::text[] <@ p.extra_ids
           on conflict on constraint cart_items_line_key
           do update set quantity = least(cart_items.quantity + excluded.quantity, 99)`,
          [user.id, line.productId, line.variantId, extraIds, line.quantity]
        );
      }
      return { lines: (await q.rows<CartRow>(CART_SQL, [user.id])).map(cartLine) };
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
          // One row per dish, size and set of extras (the table's key), however the browser listed them.
          const rows = new Map<string, { productId: string; variantId: string; extraIds: string[]; quantity: number }>();
          for (const line of shop.lines) {
            const extraIds = [...new Set(line.extraIds)].sort();
            const key = `${line.productId}|${line.variantId}|${extraIds.join(',')}`;
            rows.set(key, { ...line, extraIds, quantity: (rows.get(key)?.quantity ?? 0) + line.quantity });
          }
          for (const line of rows.values()) {
            await q.rows(
              `insert into cart_items (user_id, product_id, seller_id, variant_id, extra_ids, quantity)
               values ($1, $2, $3, $4, $5::text[], $6)`,
              [user.id, line.productId, shop.sellerId, line.variantId, line.extraIds, line.quantity]
            );
          }
          const result = await q.one<{ id: string }>('select place_order($1, $2, $3, $4) as id', [
            input.addressId,
            shop.sellerId,
            // Online or cash on delivery, as the customer chose; place_order refuses one the shop does not offer.
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
        `select o.id, o.order_code, o.status, o.total_paise, o.accepted_at, o.created_at,
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
          `select id, product_id, name, variant_label, combo_items, extras, quantity, unit_price_paise, line_total_paise
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
