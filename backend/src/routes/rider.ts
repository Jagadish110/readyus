import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { asUser, databaseMessage } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });

const KNOWN = /^[A-Z][A-Z_]+(:.*)?$/s;
function ruleError(error: unknown): never {
  const message = databaseMessage(error);
  if (KNOWN.test(message)) throw new AppError(409, message, 'DATABASE_RULE');
  throw error;
}

export const riderRoutes: FastifyPluginAsync = async (app) => {
  const action = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  /** The caller's delivery profile and the shops whose team they are on. */
  app.get('/me', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const agent = await q.one<{ id: string; full_name: string; status: string }>(
        'select id, full_name, status from delivery_agents where user_id = $1',
        [user.id]
      );
      if (!agent) return { agent: null, fleets: [] };
      const fleets = await q.rows<{ shop_name: string }>(
        `select s.shop_name from delivery_relationships r join sellers s on s.id = r.seller_id
         where r.agent_id = $1 and r.active`,
        [agent.id]
      );
      return { agent, fleets: fleets.map((fleet) => fleet.shop_name) };
    });
  });

  app.post('/apply', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const body = z
      .object({
        fullName: z.string().trim().min(2).max(100),
        phone: z.string().trim().min(10).max(20),
        vehicle: z.string().trim().min(1).max(40)
      })
      .parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select apply_to_deliver($1, $2, $3)', [body.fullName, body.phone, body.vehicle]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  /**
   * The deliveries the shops have assigned to this rider, the route for each one in progress,
   * and the last few finished.
   */
  app.get('/deliveries', async (request) => {
    const user = await requireUser(request);
    return asUser(user.id, async (q) => {
      const rows = (status: string, order: string, limit: number) =>
        q.rows<{ order_id: string }>(
          `select da.order_id, da.status, da.cash_due_paise, da.claimed_at, da.picked_up_at, da.delivered_at,
                  jsonb_build_object(
                    'order_code', o.order_code,
                    'delivery_address', o.delivery_address,
                    'seller', jsonb_build_object('shop_name', s.shop_name, 'address', s.address, 'phone', s.phone)
                  ) as "order"
           from delivery_assignments da
           join orders o on o.id = da.order_id
           join sellers s on s.id = o.seller_id
           where da.agent_id = current_agent_id() and da.status::text = any(string_to_array($1, ','))
           order by ${order} limit ${limit}`,
          [status]
        );

      const [active, history] = await Promise.all([
        rows('claimed,picked_up', 'da.claimed_at asc', 20),
        rows('delivered', 'da.delivered_at desc', 10)
      ]);

      // Coordinates for the route come from the same function the customer's map uses.
      const maps: Record<string, unknown> = {};
      for (const assignment of active) {
        const map = await q.one('select * from order_map($1)', [assignment.order_id]);
        if (map) maps[assignment.order_id] = map;
      }
      return { active, history, maps };
    });
  });

  /** The rider's position, accepted only while they hold an unfinished delivery. */
  app.post('/location', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { lat, lng } = z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select report_agent_location($1, $2)', [lat, lng]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  app.post('/join', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { code } = z.object({ code: z.string().trim().min(4).max(20) }).parse(request.body);
    try {
      await asUser(user.id, (q) => q.rows('select redeem_delivery_invite($1)', [code.toUpperCase()]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  app.post('/deliveries/:id/pickup', action, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    try {
      await asUser(user.id, (q) => q.rows('select pickup_delivery($1)', [id]));
    } catch (error) {
      ruleError(error);
    }
    return { ok: true };
  });

  app.post('/deliveries/:id/complete', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request) => {
    const user = await requireUser(request);
    const { id } = idParams.parse(request.params);
    const { code } = z.object({ code: z.string().trim().min(1).max(10) }).parse(request.body);
    try {
      const result = await asUser(user.id, (q) => q.one<{ result: string }>('select complete_delivery($1, $2) as result', [id, code]));
      // A wrong code is an answer, not an exception, so the attempt counter survives it.
      if (result?.result !== 'OK') throw new AppError(409, result?.result ?? 'INVALID_DELIVERY_CODE', 'DATABASE_RULE');
    } catch (error) {
      if (error instanceof AppError) throw error;
      ruleError(error);
    }
    return { ok: true };
  });
};
