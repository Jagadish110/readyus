import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { asAnon } from '../lib/db.js';

const bool = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const place = {
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.1).max(100).default(5),
  mode: z.enum(['food', 'items']).optional()
};

const text = (max: number) => z.string().trim().max(max).optional();

const sellersQuery = z.object({
  ...place,
  openOnly: bool,
  search: text(80),
  limit: z.coerce.number().int().min(1).max(200).default(40)
});

const productsQuery = z.object({
  ...place,
  category: text(60),
  search: text(80),
  sort: z.enum(['distance', 'price_asc', 'price_desc', 'rating', 'newest']).default('distance'),
  sellerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(300).default(40)
});

const categoriesQuery = z.object(place);

/**
 * The shop catalogue is public: guests can browse and fill a cart before they
 * sign in. These run as the anonymous role, so they can never read anything a
 * visitor could not already see.
 */
export const publicRoutes: FastifyPluginAsync = async (app) => {
  const limits = { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } };

  app.get('/sellers', limits, async (request) => {
    const q = sellersQuery.parse(request.query);
    return {
      rows: await asAnon((db) =>
        db.rows('select * from nearby_sellers($1, $2, $3, $4::listing_mode, $5, $6, $7, 0)', [
          q.lat,
          q.lng,
          q.radiusKm,
          q.mode ?? null,
          q.openOnly ?? false,
          q.search || null,
          q.limit
        ])
      )
    };
  });

  app.get('/products', limits, async (request) => {
    const q = productsQuery.parse(request.query);
    return {
      rows: await asAnon((db) =>
        db.rows('select * from nearby_products($1, $2, $3, $4::listing_mode, $5, $6, $7, $8::uuid, $9, 0)', [
          q.lat,
          q.lng,
          q.radiusKm,
          q.mode ?? null,
          q.category || null,
          q.search || null,
          q.sort,
          q.sellerId ?? null,
          q.limit
        ])
      )
    };
  });

  app.get('/categories', limits, async (request) => {
    const q = categoriesQuery.parse(request.query);
    return {
      rows: await asAnon((db) =>
        db.rows('select * from nearby_categories($1, $2, $3, $4::listing_mode)', [q.lat, q.lng, q.radiusKm, q.mode ?? null])
      )
    };
  });

  /** FSSAI numbers of shops, shown to customers as the law requires. Only reviewed, unexpired licences appear. */
  app.get('/licences', limits, async (request) => {
    const { ids } = z.object({ ids: z.string().regex(/^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,49}$/i) }).parse(request.query);
    return { rows: await asAnon((db) => db.rows('select * from seller_licences($1::uuid[])', [ids.split(',')])) };
  });
};
