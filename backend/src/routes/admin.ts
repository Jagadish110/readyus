import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { asUser, databaseMessage, type Q } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { supabase } from '../lib/supabase.js';
import { DOCUMENT_BUCKET } from './documents.js';

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
      const [sellers, products, documents] = await Promise.all([
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
        ),
        q.rows('select * from admin_pending_documents()')
      ]);
      return { sellers, products, documents };
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

  /** A shop's documents with short-lived links to the files (private storage, so each link expires in 5 minutes). */
  app.get('/sellers/:id/documents', async (request) => {
    const { id } = idParams.parse(request.params);
    const rows = await requireAdmin(request, (q) =>
      q.rows<{ kind: string; file_path: string }>('select * from admin_seller_documents($1)', [id])
    );
    const documents = await Promise.all(
      rows.map(async ({ file_path, ...rest }) => {
        const signed = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(file_path, 300);
        return { ...rest, url: signed.data?.signedUrl ?? null, isPdf: file_path.toLowerCase().endsWith('.pdf') };
      })
    );
    return { documents };
  });

  app.post('/sellers/:id/documents/:kind', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const { id, kind } = z.object({ id: z.string().uuid(), kind: z.enum(['fssai', 'gst']) }).parse(request.params);
    const { approve, note } = review.parse(request.body);
    try {
      await requireAdmin(request, (q) => q.rows('select review_seller_document($1, $2, $3, $4)', [id, kind, approve, note]));
    } catch (error) {
      if (error instanceof AppError) throw error;
      ruleError(error);
    }
    return { ok: true };
  });
  const search = z.object({
    q: z.string().trim().max(80).default(''),
    status: z.string().trim().max(40).default(''),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  });
  const suspend = z.object({ suspend: z.boolean(), reason: z.string().trim().max(300).default('') });

  /** Runs one database function as the admin and turns its rule errors into 409s. */
  async function run<T>(request: FastifyRequest, work: (q: Q, userId: string) => Promise<T>): Promise<T> {
    try {
      return await requireAdmin(request, work);
    } catch (error) {
      if (error instanceof AppError) throw error;
      ruleError(error);
    }
  }

  app.get('/overview', async (request) => run(request, async (q) => (await q.one<{ overview: unknown }>('select admin_overview() as overview'))?.overview));

  app.get('/shops', async (request) => {
    const { q: term, limit } = search.parse(request.query);
    return { shops: await run(request, (q) => q.rows('select * from admin_shops($1, $2)', [term, limit])) };
  });

  app.post('/shops/:id/suspend', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = suspend.parse(request.body);
    await run(request, (q) => q.rows('select admin_set_shop_suspended($1, $2, $3)', [id, body.suspend, body.reason]));
    return { ok: true };
  });

  app.get('/riders', async (request) => {
    const { q: term, limit } = search.parse(request.query);
    return { riders: await run(request, (q) => q.rows('select * from admin_riders($1, $2)', [term, limit])) };
  });

  app.post('/riders/:id/suspend', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = suspend.parse(request.body);
    await run(request, (q) => q.rows('select admin_set_rider_suspended($1, $2, $3)', [id, body.suspend, body.reason]));
    return { ok: true };
  });

  app.get('/orders', async (request) => {
    const { q: term, status, limit } = search.parse(request.query);
    return { orders: await run(request, (q) => q.rows('select * from admin_orders($1, $2, $3)', [term, status, limit])) };
  });

  app.get('/orders/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    return run(request, async (q) => (await q.one<{ detail: unknown }>('select admin_order_detail($1) as detail', [id]))?.detail);
  });

  app.post('/orders/:id/refund', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ amount_paise: z.number().int().positive().max(10_000_000), reason: z.string().trim().max(200).default('') }).parse(request.body);
    await run(request, (q) => q.rows('select admin_request_refund($1, $2, $3)', [id, body.amount_paise, body.reason]));
    return { ok: true };
  });

  app.post('/issues/:id/resolve', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = z.object({ note: z.string().trim().max(300).default('') }).parse(request.body);
    await run(request, (q) => q.rows('select resolve_order_issue($1, $2)', [id, body.note]));
    return { ok: true };
  });

  app.get('/admins', async (request) => ({ admins: await run(request, (q) => q.rows('select * from admin_list_admins()')) }));

  app.post('/admins', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).parse(request.body);
    await run(request, (q) => q.rows('select admin_grant_admin($1)', [email]));
    return { ok: true };
  });

  app.post('/admins/:id/remove', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    await run(request, (q) => q.rows('select admin_revoke_admin($1)', [id]));
    return { ok: true };
  });
};

