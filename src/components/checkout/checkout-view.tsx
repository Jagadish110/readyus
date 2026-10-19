'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useCart } from '@/lib/state/cart';
import { useLocation } from '@/lib/state/location';
import { Button, ButtonLink } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { Dish } from '@/components/art/dish-photo';
import { cn, formatRupees } from '@/lib/utils';

const PLATFORM_FEE = 5;
const DELIVERY_FEE = 25;

type PayChoice = 'cod' | 'online';

export function CheckoutView() {
  const { groups, ready, subtotal, clear } = useCart();
  const { location } = useLocation();
  const [pay, setPay] = useState<PayChoice>('cod');
  const [placed, setPlaced] = useState(false);
  const [note, setNote] = useState('');

  const totals = useMemo(() => {
    const delivery = groups.length * DELIVERY_FEE;
    const platform = groups.length * PLATFORM_FEE;
    return { delivery, platform, total: subtotal + delivery + platform };
  }, [groups.length, subtotal]);

  if (!ready) return <div className="skeleton h-72 rounded-[26px]" />;

  if (placed) {
    return (
      <div className="animate-rise mx-auto mt-8 max-w-md rounded-[30px] bg-[var(--surface)] p-9 text-center shadow-lg ring-1 ring-[var(--line)]">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--leaf-soft)] text-3xl text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
          &#10003;
        </span>
        <h1 className="mt-5 font-display text-2xl font-extrabold tracking-[-0.035em]">Order placed</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          Each shop now has five minutes to accept. You will be notified the moment they do.
        </p>
        <ButtonLink href="/orders" variant="leaf" size="lg" fullWidth className="mt-6">
          Track your orders
        </ButtonLink>
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div className="animate-rise mx-auto mt-8 max-w-md rounded-[30px] bg-[var(--surface)] p-9 text-center shadow-sm ring-1 ring-[var(--line)]">
        <span
          aria-hidden
          className="relative mx-auto block size-28 overflow-hidden rounded-full bg-[var(--tile)]"
        >
          <Dish name="kirana" sizes="112px" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-extrabold tracking-[-0.035em]">
          Nothing to check out
        </h1>
        <ButtonLink href="/browse" variant="leaf" size="lg" className="mt-6">
          Browse shops
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="grid gap-5">
        <div className="animate-rise">
          <Eyebrow>Almost there</Eyebrow>
          <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">
            Checkout
          </h1>
        </div>

        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] [animation-delay:60ms]">
          <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">Delivering to</h2>
          <p className="mt-2 text-sm font-semibold">{location?.label ?? 'No location set'}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Within {location?.radiusKm ?? 5} km &middot; every shop below can reach this address
          </p>
          <Link
            href="/location"
            className="mt-3 inline-block rounded-full bg-[var(--leaf-soft)] px-4 py-2 text-sm font-bold text-[var(--leaf-ink)] transition-colors hover:bg-[var(--leaf-soft)]0/15"
          >
            Change
          </Link>
        </section>

        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] [animation-delay:100ms]">
          <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">How you will pay</h2>
          <div className="mt-3 grid gap-2.5">
            <PayOption
              id="cod"
              active={pay === 'cod'}
              onSelect={setPay}
              title="Cash on delivery"
              body="Pay the delivery partner when your order arrives."
            />
            <PayOption
              id="online"
              active={pay === 'online'}
              onSelect={setPay}
              title="Pay online by UPI"
              body="Pay the shop's UPI ID now; they confirm before preparing."
            />
          </div>

          {pay === 'online' && (
            <p className="mt-3 rounded-[18px] bg-warning/12 px-4 py-3 text-xs leading-relaxed font-medium text-[var(--text)] ring-1 ring-warning/35">
              Online payments are verified manually by each shop today. Your order starts once
              they confirm receipt.
            </p>
          )}
        </section>

        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] [animation-delay:140ms]">
          <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">
            Anything the shop should know?
          </h2>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Less spicy, no onion, ring the bell twice..."
            className="mt-3 w-full resize-none rounded-[18px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] p-3.5 text-sm outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20"
          />
        </section>
      </div>

      <aside className="animate-rise sticky top-24 grid gap-4 rounded-[26px] bg-[var(--surface)] p-6 shadow-sm ring-1 ring-[var(--line)] [animation-delay:80ms]">
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">
          {groups.length === 1 ? 'Your order' : groups.length + ' orders'}
        </h2>

        <ul className="grid gap-2 text-sm">
          {groups.map((group) => (
            <li key={group.sellerId} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-[var(--text-muted)]">{group.sellerName}</span>
              <span className="shrink-0 font-bold tabular-nums">{formatRupees(group.subtotal)}</span>
            </li>
          ))}
        </ul>

        <dl className="grid gap-2 border-t border-[var(--line)] pt-3 text-sm">
          <Row label="Items" value={formatRupees(subtotal)} />
          <Row label={'Delivery (' + groups.length + ')'} value={formatRupees(totals.delivery)} />
          <Row label="Platform fee" value={formatRupees(totals.platform)} />
        </dl>

        <div className="flex items-baseline justify-between border-t border-[var(--line)] pt-3">
          <span className="font-bold">{pay === 'cod' ? 'Pay on delivery' : 'Pay now'}</span>
          <span className="font-display text-xl font-extrabold tabular-nums text-brand-600">
            {formatRupees(totals.total)}
          </span>
        </div>

        <Button
          size="lg"
          fullWidth
          onClick={() => {
            clear();
            setPlaced(true);
          }}
        >
          Place {groups.length > 1 ? groups.length + ' orders' : 'order'}
        </Button>

        <p className="text-center text-xs text-[var(--text-muted)]">
          Connect Supabase to place real orders. This runs the full UI flow.
        </p>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function PayOption({
  id,
  active,
  onSelect,
  title,
  body
}: {
  id: PayChoice;
  active: boolean;
  onSelect: (value: PayChoice) => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={active}
      className={cn(
        'flex items-start gap-3 rounded-[18px] border-[1.5px] p-3.5 text-left transition-all duration-200',
        active
          ? 'border-leaf-500 bg-[var(--leaf-soft)]'
          : 'border-[var(--line)] hover:border-leaf-300 hover:bg-[var(--tile)]'
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px]',
          active ? 'border-leaf-600 bg-leaf-600' : 'border-[var(--line)]'
        )}
      >
        {active && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs leading-relaxed text-[var(--text-muted)]">{body}</span>
      </span>
    </button>
  );
}
