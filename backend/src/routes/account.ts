import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from '../lib/auth.js';
import { asUser } from '../lib/db.js';

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
};
