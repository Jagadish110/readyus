import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { serverApi } from '@/lib/api/server';
import { Button, ButtonLink } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { signOut } from './actions';

export const metadata: Metadata = { title: 'Your account' };

const ROLE_LABELS: Record<string, string> = {
  customer: 'Customer',
  seller: 'Seller',
  delivery: 'Delivery partner',
  admin: 'Admin'
};

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
          <div>
            <dt className="text-xs font-bold tracking-[0.14em] text-[var(--text-muted)] uppercase">Roles</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {(held.length ? held : ['customer']).map((role) => (
                <span
                  key={role}
                  className="rounded-full bg-[var(--leaf-soft)] px-2.5 py-1 text-xs font-extrabold text-[var(--leaf-ink)] ring-1 ring-[var(--line)]"
                >
                  {ROLE_LABELS[role] ?? role}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </section>

      <section className="animate-rise grid gap-3 sm:grid-cols-2 [animation-delay:120ms]">
        <ButtonLink href="/browse" variant="leaf-outline" size="lg" fullWidth>
          Keep shopping
        </ButtonLink>
        {!held.includes('seller') && (
          <ButtonLink href="/business/apply" variant="leaf-soft" size="lg" fullWidth>
            Sell on ReadyUs
          </ButtonLink>
        )}
      </section>

      <form action={signOut} className="animate-rise [animation-delay:160ms]">
        <Button type="submit" variant="outline" size="lg" fullWidth>
          Sign out
        </Button>
      </form>

      <p className="text-center text-xs text-[var(--text-muted)]">
        Need help? Visit{' '}
        <Link href="/legal/privacy" className="font-semibold text-[var(--leaf-ink)] hover:underline">
          Privacy
        </Link>
        .
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
