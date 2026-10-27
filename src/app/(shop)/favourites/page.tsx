import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { serverApi } from '@/lib/api/server';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { StarIcon } from '@/components/shell/icons';

export const metadata: Metadata = { title: 'Favourite shops' };
export const dynamic = 'force-dynamic';

type Favourite = {
  id: string;
  shop_name: string;
  category: string;
  city: string;
  rating: number | string;
  rating_count: number;
  available: boolean;
  is_open: boolean;
};

export default async function FavouritesPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/favourites');

  const result = await serverApi<{ shops: Favourite[] }>('/v1/favourites');
  if (!result.ok) throw new Error('We could not load your favourites right now. Please try again.');
  const shops = result.data.shops;

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <div className="animate-rise">
        <Eyebrow>Saved by you</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">Favourite shops</h1>
      </div>

      {shops.length === 0 ? (
        <Card className="grid justify-items-center gap-2 p-8 text-center">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">No favourites yet</h2>
          <p className="max-w-sm text-sm text-[var(--text-muted)]">Tap the heart on a shop to keep it here, so you can order from it again in two taps.</p>
          <ButtonLink href="/browse" variant="leaf" size="sm" className="mt-2">Browse shops</ButtonLink>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {shops.map((shop) => (
            <li key={shop.id}>
              <Link href={`/shop/${shop.id}`} className="flex items-center justify-between gap-3 rounded-[22px] bg-[var(--surface)] p-4 shadow-sm ring-1 ring-[var(--line)] transition-colors hover:ring-leaf-400">
                <span className="min-w-0">
                  <span className="block truncate font-display text-base font-extrabold tracking-[-0.025em]">{shop.shop_name}</span>
                  <span className="block truncate text-sm text-[var(--text-muted)]">
                    {[shop.category, shop.city].filter(Boolean).join(' · ')}
                  </span>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-bold">
                    <StarIcon className="size-3.5 text-saffron-500" />
                    {Number(shop.rating) > 0 ? Number(shop.rating).toFixed(1) : 'New'}
                    {shop.rating_count > 0 && <span className="font-medium text-[var(--text-muted)]">({shop.rating_count})</span>}
                  </span>
                </span>
                <Badge tone={!shop.available ? 'neutral' : shop.is_open ? 'success' : 'warning'}>
                  {!shop.available ? 'Not taking orders' : shop.is_open ? 'Open' : 'Closed now'}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
