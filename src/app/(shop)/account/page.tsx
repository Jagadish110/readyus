import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { serverApi } from '@/lib/api/server';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { BikeIcon, ChevronIcon, HeartIcon, OrdersIcon, ShieldIcon, StoreIcon } from '@/components/shell/icons';
import { signOut } from './actions';
import { AddressBook } from '@/components/account/address-book';
import { DataControls } from '@/components/account/data-controls';

export const metadata: Metadata = { title: 'Your account' };

function initials(name: string, fallback: string) {
  const source = name.trim() || fallback;
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // The proxy already sends signed-out visitors to /sign-in; this covers a
  // session that expired between that check and this render.
  if (!user) redirect('/sign-in?next=/account');

  type ProfileRow = {
    full_name: string;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
    search_radius_km: number;
    created_at: string;
  };
  const me = await serverApi<{ profile: ProfileRow | null; roles: string[] }>('/v1/me');
  // A server outage must not show a signed-in person an empty account.
  if (!me.ok) throw new Error('We could not load your account right now. Please try again.');
  const profile = me.data.profile;
  const roles = me.data.roles.map((role) => ({ role }));

  const email = profile?.email ?? user.email ?? '';
  const phone = profile?.phone ?? user.phone ?? '';
  const name = profile?.full_name || user.user_metadata?.full_name || user.user_metadata?.name || '';
  const avatar = profile?.avatar_url ?? user.user_metadata?.avatar_url ?? null;
  const held = (roles ?? []).map((row) => String(row.role));
  const since = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div className="animate-rise">
        <Eyebrow>Your account</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">
          {name ? 'Hi, ' + name.split(' ')[0] : 'Welcome'}
        </h1>
      </div>

      <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-6 shadow-sm ring-1 ring-[var(--line)] [animation-delay:60ms]">
        <div className="flex items-center gap-4">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="size-16 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span
              aria-hidden
              className="grid size-16 shrink-0 place-items-center rounded-full bg-leaf-600 font-display text-xl font-extrabold text-white"
            >
              {initials(name, email || phone || 'U')}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-extrabold tracking-[-0.03em]">
              {name || 'No name yet'}
            </p>
            {since && <p className="text-sm text-[var(--text-muted)]">Member since {since}</p>}
          </div>
        </div>

        <dl className="mt-6 grid gap-4 border-t border-[var(--line)] pt-5 text-sm sm:grid-cols-2">
          <Detail label="Email" value={email} />
          <Detail label="Mobile" value={phone} />
          <Detail label="Delivery radius" value={profile ? profile.search_radius_km + ' km' : ''} />
        </dl>
      </section>

      {/* One list of everywhere this person can go, so the shop and admin consoles are reachable from a phone. */}
      <nav
        aria-label="Account"
        className="animate-rise overflow-hidden rounded-[26px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)] [animation-delay:120ms]"
      >
        <ul className="divide-y divide-[var(--line)]">
          {[
            { href: '/orders', label: 'Your orders', hint: 'Track, reorder and get receipts', Icon: OrdersIcon },
            { href: '/favourites', label: 'Favourite shops', hint: 'Shops you saved', Icon: HeartIcon },
            held.includes('seller')
              ? { href: '/business', label: 'Your shop dashboard', hint: 'Orders, menu and payouts', Icon: StoreIcon }
              : { href: '/business/apply', label: 'Sell on Localty', hint: 'List your shop, zero commission', Icon: StoreIcon },
            ...(held.includes('delivery')
              ? [{ href: '/delivery', label: 'Rider console', hint: 'Your deliveries', Icon: BikeIcon }]
              : []),
            ...(held.includes('admin')
              ? [{ href: '/admin', label: 'Admin console', hint: 'Approvals, shops and orders', Icon: ShieldIcon }]
              : [])
          ].map(({ href, label, hint, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                transitionTypes={['nav-forward']}
                className="flex min-h-16 items-center gap-3.5 px-5 py-3 transition-colors hover:bg-[var(--tile)] active:bg-[var(--leaf-soft)]"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--leaf-soft)] text-[var(--leaf-ink)]">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{label}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">{hint}</span>
                </span>
                <ChevronIcon className="size-4 shrink-0 text-[var(--text-muted)]" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <AddressBook />

      <DataControls />

      <form action={signOut} className="animate-rise [animation-delay:160ms]">
        <Button type="submit" variant="outline" size="lg" fullWidth>
          Sign out
        </Button>
      </form>

      <p className="flex justify-center gap-1 text-xs text-[var(--text-muted)]">
        {[
          ['/legal/terms', 'Terms'],
          ['/legal/privacy', 'Privacy'],
          ['/legal/refunds', 'Refunds']
        ].map(([href, label]) => (
          <Link key={href} href={href} className="inline-flex h-11 items-center px-2.5 font-semibold text-[var(--leaf-ink)] hover:underline">
            {label}
          </Link>
        ))}
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold tracking-[0.14em] text-[var(--text-muted)] uppercase">{label}</dt>
      <dd className="mt-1.5 truncate font-semibold">{value || <span className="text-[var(--text-muted)]">Not added</span>}</dd>
    </div>
  );
}
