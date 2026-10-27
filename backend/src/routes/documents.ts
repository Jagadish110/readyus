import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { asUser, databaseMessage } from '../lib/db.js';
import { DOCUMENT_TYPES, documentSchema } from '../lib/documents.js';
import { AppError } from '../lib/errors.js';
import { supabase } from '../lib/supabase.js';

export const DOCUMENT_BUCKET = 'seller-documents';

const KNOWN = /^[A-Z][A-Z_]+(:.*)?$/s;
function ruleError(error: unknown): never {
  const message = databaseMessage(error);
  if (KNOWN.test(message)) throw new AppError(409, message, 'DATABASE_RULE');
  throw error;
}

/** The shop owner's own verification documents (FSSAI licence, GST). */
export const documentRoutes: FastifyPluginAsync = async (app) => {
  /** What the owner has sent and where each stands, plus whether this kind of shop must have an FSSAI licence. */
  app.get('/', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const shop = await q.one<{ id: string; listing_mode: 'food' | 'items'; documents_due_at: string | null }>(
        'select id, listing_mode, documents_due_at from sellers where user_id = $1',
        [user.id]
      );
      if (!shop) throw new AppError(404, 'Create your shop first.', 'NO_SHOP');
      const documents = await q.rows('select * from my_seller_documents()');
      return {
        documents,
        fssaiRequired: shop.listing_mode === 'food',
        dueAt: shop.documents_due_at
      };
    });
  });

  /** A one-time link to put one file into this shop's private folder. The server picks the path. */
  app.post('/uploads', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const { kind, contentType } = z.object({ kind: z.enum(['fssai', 'gst']), contentType: z.string() }).parse(request.body);

    const extension = DOCUMENT_TYPES[contentType];
    if (!extension) throw new AppError(400, 'Upload a PDF, JPG, PNG or WebP file.');

    const shop = await asUser(user.id, (q) => q.one<{ id: string }>('select id from sellers where user_id = $1', [user.id]));
    if (!shop) throw new AppError(404, 'Create your shop first.', 'NO_SHOP');

    const path = `${shop.id}/${kind}-${randomUUID()}.${extension}`;
    const signed = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data) throw signed.error ?? new Error('Could not create an upload link.');
    return { uploadUrl: signed.data.signedUrl, path };
  });

  /** Saves the number, expiry and the uploaded file, and sends it to the reviewers. */
  app.post('/', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const body = documentSchema.parse(request.body);
    try {
      await asUser(user.id, (q) =>
        q.rows('select submit_seller_document($1, $2, $3::date, $4)', [
          body.kind,
          body.number,
          body.kind === 'fssai' ? body.validUntil : null,
          body.path
        ])
      );
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });
};
