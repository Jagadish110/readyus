import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loose, SHOP_COLUMNS, type ShopRow } from './db';

/** The signed-in owner's shop, or a redirect to the application page. */
export async function requireShop() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/business');

  const { data } = await loose(supabase)
    .from('sellers')
    .select(SHOP_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle();
  const shop = data as ShopRow | null;
  if (!shop) redirect('/business/apply');
  return { supabase, shop };
}
