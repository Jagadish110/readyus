import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { asUser, databaseMessage, type Q } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

const idParams = z.object({ id: z.string().uuid() });

/** Admin is invite-only: checked here, and again inside each database function. */
async function requireAdmin<T>(request: FastifyRequest, work: (q: Q, userId: string) => Promise<T>): Promise<T> {
  const user = await requireUser(request);
  return asUser(user.id, async (q) => {
    const admin = await q.one<{ ok: boolean }>('select is_admin() as ok');
    if (!admin?.ok) throw new AppError(403, 'Admins only.');
    return work(q, user.id);
  });
}

const KNOWN = /^[A-Z][A-Z_]+(:.*)?$/s;
function ruleError(error: unknown): never {
  const message = databaseMessage(error);
  if (KNOWN.test(message)) throw new AppError(409, message, 'DATABASE_RULE');
  throw error;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const review = z.object({ approve: z.boolean(), note: z.string().trim().max(300).default('') });

  app.get('/approvals', async (request) => {
    return requireAdmin(request, async (q) => {
      const [sellers, products] = await Promise.all([
        q.rows(
          `select id, shop_name, owner_name, phone, category, listing_mode, address, city, pincode, created_at,
                  case when location is null then null
                       else jsonb_build_object('lat', st_y(location::geometry), 'lng', st_x(location::geometry)) end as pin
           from sellers where status = 'pending' order by created_at desc`
        ),
        q.rows(
          `select p.id, p.name, p.price, p.unit, p.category_key, p.listing_mode, p.created_at,
                  jsonb_build_object('shop_name', s.shop_name) as sellers
           from products p left join sellers s on s.id = p.seller_id
           where p.approval_status = 'pending' order by p.created_at desc`
        )
      ]);
      return { sellers, products };
    });
  });

  app.post('/approvals/shops/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { approve, note } = review.parse(request.body);
    try {
      await requireAdmin(request, (q) => q.rows('select review_seller($1, $2, $3)', [id, approve, note]));
    } catch (error) {
      if (error instanceof AppError) throw error;
      ruleError(error);
    }
    return { ok: true };
  });

  app.post('/approvals/products/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const { approve, note } = review.parse(request.body);
    try {
      await requireAdmin(request, (q) => q.rows('select review_product($1, $2, $3)', [id, approve, note]));
    } catch (error) {
      if (error instanceof AppError) throw error;
      ruleError(error);
    }
    return { ok: true };
  });
};
