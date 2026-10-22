import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { serverApi } from '@/lib/api/server';
import type { ShopRow } from './db';

/** The signed-in owner's shop, or a redirect to the application page. */
export async function requireShop() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/business');

  const result = await serverApi<{ shop: ShopRow | null }>('/v1/seller/me');
  // A server outage must not look like "you have no shop" and bounce the owner to the apply page.
  if (!result.ok) throw new Error('We could not load your shop right now. Please try again.');
  if (!result.data.shop) redirect('/business/apply');
  return { shop: result.data.shop };
}
