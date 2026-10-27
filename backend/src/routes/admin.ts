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
};

