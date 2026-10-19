import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { ordersDb } from '@/lib/orders/db';

/**
 * Cancels orders a shop never answered within the accept window and returns
 * their stock. Point a scheduler (Vercel Cron, pg_cron, any pinger) at this
 * every minute with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await ordersDb(createAdminClient()).rpc('expire_stale_orders');
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json({ expired: result.data ?? 0 });
}
