import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { asService, asUser, databaseMessage } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { supabase } from '../lib/supabase.js';
import { z } from 'zod';

export const accountRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Who the caller is and which roles they hold. Roles are read from the
   * database on every call, never from the login token, so a revoked role stops
   * working immediately.
   */
  app.get('/me', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const [profile, roles] = await Promise.all([
        q.one(
          'select full_name, phone, email, avatar_url, search_radius_km, created_at from profiles where id = $1',
          [user.id]
        ),
        q.rows<{ role: string }>('select role from user_roles where user_id = $1', [user.id])
      ]);
      return { profile, roles: roles.map((row) => row.role) };
    });
  });

  /** Everything we hold about the caller, as a file they can keep. */
  app.get('/account/export', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const [profile, addresses, orders, reviews, favourites, notifications] = await Promise.all([
        q.one('select full_name, phone, email, created_at from profiles where id = $1', [user.id]),
        q.rows(
          `select label, recipient, phone, line1, line2, landmark, city, pincode, is_default, created_at,
                  st_y(location::geometry) as lat, st_x(location::geometry) as lng
           from addresses where user_id = $1 order by created_at`,
          [user.id]
        ),
        q.rows(
          `select o.order_code, o.status, o.payment_mode, o.total_paise, o.verified_prepaid_paise, o.refunded_paise, o.created_at,
                  o.delivery_address, o.customer_note, o.cancel_reason,
                  (select shop_name from sellers where id = o.seller_id) as shop,
                  coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'price_paise', i.unit_price_paise))
                            from order_items i where i.order_id = o.id), '[]'::jsonb) as items
           from orders o where o.customer_id = $1 order by o.created_at`,
          [user.id]
        ),
        q.rows('select rating, body, created_at from reviews where author_id = $1 order by created_at', [user.id]),
        q.rows('select (select shop_name from sellers where id = f.seller_id) as shop, created_at from favourite_sellers f where user_id = $1', [user.id]),
        q.rows('select title, body, created_at from notifications where user_id = $1 order by created_at desc limit 200', [user.id])
      ]);
      return { exported_at: new Date().toISOString(), profile, addresses, orders, reviews, favourites, notifications };
    });
  });

  /**
   * Erases the caller's personal details. Orders are kept without anything that says who or where.
   * Not possible while an order is open, or for a shop or delivery account (those are closed with us directly).
   */
  app.post('/account/delete', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    z.object({ confirm: z.literal('DELETE') }).parse(request.body);

    try {
      await asService((q) => q.rows('select anonymize_customer($1)', [user.id]));
    } catch (error) {
      const message = databaseMessage(error);
      const reasons: Record<string, string> = {
        HAS_SHOP: 'This account runs a shop. Contact us to close the shop first.',
        HAS_DELIVERY_PROFILE: 'This account is a delivery partner. Contact us to close it first.',
        ACTIVE_ORDERS: 'You have an order in progress. You can delete your account once it is finished.',
        REFUND_PENDING: 'A refund to you is still being processed. Try again once it has gone through.'
      };
      const code = Object.keys(reasons).find((key) => message.includes(key));
      if (code) throw new AppError(409, reasons[code]!, code);
      throw error;
    }

    // The login is closed last; the personal data above is already gone if this step fails, and it can be retried.
    const closed = await supabase.auth.admin.deleteUser(user.id, true);
    if (closed.error) {
      request.log.error({ cause: closed.error.message }, 'could not close the login after erasing data');
      throw new AppError(502, 'Your details were erased, but closing the login failed. Please try again.', 'LOGIN_NOT_CLOSED');
    }
    return { ok: true };
  });
};
