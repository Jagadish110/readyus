'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/orders/errors';
import { ordersDb } from '@/lib/orders/db';
import { loadOrder, type OrderView } from '@/lib/orders/load';
import {
  canCancel,
  etaFor,
  formatClock,
  isActive,
  isEnded,
  minutesLeft,
  STATUS_LABEL,
  STATUS_TONE,
  stepOf,
  timeAgo,
  TIMELINE,
  type OrderStatus
} from '@/lib/orders/status';
import { LiveMap } from '@/components/maps/live-map';
import { ReviewForm } from './review-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { cn, formatPaise } from '@/lib/utils';

/**
 * Keeps one order current. Realtime events only nudge a refetch (the database
 * stays the single source of truth); without a live channel it polls every 10s.
 */
function useLiveOrder(orderId: string, initial: OrderView) {
  const [view, setView] = useState(initial);
  const [live, setLive] = useState(false);

  const refetch = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const next = await loadOrder(supabase, orderId);
    if (next) setView(next);
  }, [orderId]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    let timer: number | undefined;
    const nudge = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refetch, 400);
    };

    const channel = supabase
      .channel(`order-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_events', filter: `order_id=eq.${orderId}` }, nudge)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments', filter: `order_id=eq.${orderId}` }, nudge)
      // Row level security limits this to the customer's own rider.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_agents' }, nudge)
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [orderId, refetch]);

  const watching = isActive(view.order.status);
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(refetch, live ? 30_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [watching, live, refetch]);

  return { view, live, refetch };
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function OrderTracker({ orderId, initial }: { orderId: string; initial: OrderView }) {
  const { view, live, refetch } = useLiveOrder(orderId, initial);
  const { order, items, events, map, code, reviews } = view;
  const status = order.status;
  const now = useNow(status === 'pending' ? 1_000 : 15_000);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');

  const prep = order.seller?.eta_minutes ?? 15;
  const eta = useMemo(() => etaFor(order, prep), [order, prep]);
  const left = minutesLeft(eta.at, now);
  const step = stepOf(status);
  const ended = isEnded(status);
  const shopName = order.seller?.shop_name ?? 'the shop';

  async function run(call: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError('');
    const result = await call();
    setBusy(false);
    if (result.error) setError(friendlyError(result.error.message));
    await refetch();
  }

  const cancel = () => {
    if (!window.confirm('Cancel this order?')) return;
    const supabase = createClient();
    if (!supabase) return;
    run(() => ordersDb(supabase).rpc('cancel_order', { p_order: orderId, p_reason: 'Cancelled by customer' }));
  };

  const claimPaid = () => {
    const supabase = createClient();
    if (!supabase) return;
    run(() => ordersDb(supabase).rpc('claim_payment', { p_order: orderId, p_reference: reference.trim() }));
  };

  const eventAt = (wanted: OrderStatus[]) =>
    events.find((event) => wanted.includes(event.status))?.created_at ?? null;
  const stepTime = [
    order.created_at,
    eventAt(['accepted']),
    eventAt(['preparing']),
    eventAt(['packed']),
    eventAt(['out_for_delivery']),
    order.delivered_at
  ];

  const deadline = order.accept_deadline_at ? new Date(order.accept_deadline_at) : null;
  const secondsToAccept = deadline ? Math.max(0, Math.round((deadline.getTime() - now) / 1000)) : 0;

  const upi = order.seller?.upi_id;
  const payUrl = upi
    ? `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(shopName)}&am=${(
        order.required_online_paise / 100
      ).toFixed(2)}&cu=INR&tn=${encodeURIComponent(order.order_code)}`
    : null;

  const address = order.delivery_address;
  const addressLine = [address.line1, address.line2, address.landmark, address.city, address.pincode]
    .filter(Boolean)
    .join(', ');

  const riderPoint =
    map && map.rider_lat !== null && map.rider_lng !== null ? { lat: map.rider_lat, lng: map.rider_lng } : null;

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <div className="animate-rise">
        <Link href="/orders" className="text-sm font-bold text-[var(--leaf-ink)] hover:underline">
          &larr; All orders
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>{order.order_code}</Eyebrow>
            <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] leading-[1.05] font-extrabold tracking-[-0.04em]">
              {shopName}
            </h1>
          </div>
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
          {error}
        </p>
      )}

      {/* The one line that matters most right now. */}
      {!ended && status !== 'delivered' && (
        <section className="animate-rise rounded-[26px] bg-[var(--leaf-soft)] p-5 ring-1 ring-[var(--line)]">
          {status === 'pending' || status === 'payment_confirmed' ? (
            <>
              <p className="text-xs font-extrabold tracking-[0.16em] text-[var(--leaf-ink)] uppercase">
                Waiting for {shopName}
              </p>
              <p className="mt-1.5 font-display text-2xl font-extrabold tracking-[-0.035em]">
                They have {Math.floor(secondsToAccept / 60)}:{String(secondsToAccept % 60).padStart(2, '0')} to accept
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                If they do not answer, the order is cancelled and nothing is charged. Usual delivery after
                accepting is about {eta.minutes} minutes.
              </p>
            </>
          ) : status === 'payment_required' || status === 'payment_rejected' ? (
            <p className="font-display text-xl font-extrabold tracking-[-0.03em]">Pay to start your order</p>
          ) : status === 'customer_claimed_paid' ? (
            <p className="font-display text-xl font-extrabold tracking-[-0.03em]">
              The shop is checking your payment
            </p>
          ) : (
            <>
              <p className="text-xs font-extrabold tracking-[0.16em] text-[var(--leaf-ink)] uppercase">
                Estimated arrival
              </p>
              <p className="mt-1.5 font-display text-3xl font-extrabold tracking-[-0.04em]">
                {left > 0 ? `${left} min` : 'Any minute now'}
                <span className="ml-2 text-base font-bold text-[var(--text-muted)]">by {formatClock(eta.at)}</span>
              </p>
            </>
          )}
        </section>
      )}

      {(status === 'payment_required' || status === 'payment_rejected') && (
        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)]">
          {status === 'payment_rejected' && (
            <p className="mb-3 rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
              The shop could not find your payment. Check the amount and UPI ID, then try again.
            </p>
          )}
          <p className="text-sm text-[var(--text-muted)]">Pay exactly</p>
          <p className="font-display text-3xl font-extrabold tracking-[-0.04em] text-brand-600">
            {formatPaise(order.required_online_paise)}
          </p>
          {upi ? (
            <>
              <p className="mt-2 text-sm">
                to UPI ID <span className="font-extrabold break-all">{upi}</span>
              </p>
              {payUrl && (
                <a
                  href={payUrl}
                  className="mt-3 inline-flex h-11 items-center rounded-full bg-[var(--leaf-soft)] px-5 text-sm font-bold text-[var(--leaf-ink)] md:hidden"
                >
                  Open my UPI app
                </a>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              This shop has not added a UPI ID. Ask them for payment details
              {order.seller?.phone ? (
                <>
                  : <a href={`tel:${order.seller.phone}`} className="font-bold text-[var(--leaf-ink)] underline">{order.seller.phone}</a>
                </>
              ) : (
                '.'
              )}
            </p>
          )}
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="UPI reference / UTR (optional)"
            className="mt-4 h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-sm outline-none focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20"
          />
          <Button variant="leaf" fullWidth className="mt-3" onClick={claimPaid} loading={busy}>
            I have paid
          </Button>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            The shop confirms the money has arrived before they start. This does not charge you.
          </p>
        </section>
      )}

      {ended && (
        <section className="animate-rise rounded-[26px] bg-danger/10 p-5 ring-1 ring-danger/30">
          <p className="font-display text-xl font-extrabold tracking-[-0.03em]">{STATUS_LABEL[status]}</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {order.cancel_reason || 'This order will not be delivered.'} Nothing was charged.
          </p>
          <Link href="/browse" className="mt-3 inline-block text-sm font-bold text-[var(--leaf-ink)] underline">
            Find another shop
          </Link>
        </section>
      )}

      {code && (
        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 text-center shadow-sm ring-1 ring-[var(--line)]">
          <p className="text-xs font-extrabold tracking-[0.16em] text-[var(--leaf-ink)] uppercase">
            Delivery code
          </p>
          <p
            aria-label={`Delivery code ${code.split('').join(' ')}`}
            className="mt-2 font-display text-4xl font-extrabold tracking-[0.3em] tabular-nums"
          >
            {code}
          </p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Tell this to your rider when they arrive. Do not share it before.
          </p>
        </section>
      )}

      {/* Live map once the rider has picked the order up. */}
      {map && status === 'out_for_delivery' && (
        <section className="animate-rise grid gap-3 rounded-[26px] bg-[var(--surface)] p-4 shadow-sm ring-1 ring-[var(--line)]">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">On the map</h2>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
              <span
                aria-hidden
                className={cn('size-2 rounded-full', live ? 'animate-pulse bg-success' : 'bg-ink-300')}
              />
              {map.rider_updated_at ? `Rider updated ${timeAgo(map.rider_updated_at, now)}` : 'Waiting for the rider’s location'}
            </span>
          </div>
          <LiveMap
            shop={{ lat: map.shop_lat, lng: map.shop_lng }}
            home={{ lat: map.dest_lat, lng: map.dest_lng }}
            rider={riderPoint}
          />
          {map.rider_name && (
            <p className="px-1 text-sm">
              <span className="font-bold">{map.rider_name}</span> is bringing your order
              {map.rider_phone && (
                <>
                  {' '}
                  &middot;{' '}
                  <a href={`tel:${map.rider_phone}`} className="font-bold text-[var(--leaf-ink)] underline">
                    Call
                  </a>
                </>
              )}
            </p>
          )}
        </section>
      )}

      {(status === 'assigned' || status === 'packed') && (
        <p className="animate-rise rounded-[22px] bg-[var(--tile)] px-5 py-4 text-sm ring-1 ring-[var(--line)]">
          {status === 'assigned' && map?.rider_name
            ? `${map.rider_name} is on the way to ${shopName}. The live map appears once they pick up your order.`
            : 'Packed and waiting for a delivery partner to pick it up.'}
        </p>
      )}

      {!ended && (
        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] sm:p-6">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Order status</h2>
          <ol className="mt-4 grid gap-0">
            {TIMELINE.map((entry, index) => {
              const done = index < step || status === 'delivered';
              const current = index === step && status !== 'delivered';
              const at = stepTime[index];
              return (
                <li key={entry.key} className="relative flex gap-3.5 pb-5 last:pb-0">
                  {index < TIMELINE.length - 1 && (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-7 bottom-0 left-[13px] w-0.5',
                        index < step ? 'bg-leaf-500' : 'bg-[var(--line)]'
                      )}
                    />
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      'relative z-10 mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-extrabold',
                      done && 'bg-leaf-600 text-white',
                      current && 'bg-[var(--leaf-soft)] text-[var(--leaf-ink)] ring-2 ring-leaf-500',
                      !done && !current && 'bg-[var(--tile)] text-ink-400 ring-1 ring-[var(--line)]'
                    )}
                  >
                    {done ? '✓' : index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm font-bold',
                        !done && !current && 'text-[var(--text-muted)]'
                      )}
                    >
                      {entry.label}
                      {(done || current) && at && (
                        <span className="ml-2 text-xs font-medium text-[var(--text-muted)]">
                          {formatClock(new Date(at))}
                        </span>
                      )}
                    </span>
                    {current && <span className="block text-xs text-[var(--text-muted)]">{entry.hint}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {status === 'delivered' && (
        <ReviewForm
          orderId={orderId}
          shopName={shopName}
          items={items}
          existing={reviews}
          onSaved={refetch}
        />
      )}

      <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] sm:p-6">
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Your items</h2>
        <ul className="mt-3 grid gap-2 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span className="min-w-0">
                {item.quantity} &times; {item.name}
                {item.variant_label && <span className="text-[var(--text-muted)]"> ({item.variant_label})</span>}
              </span>
              <span className="shrink-0 font-bold tabular-nums">{formatPaise(item.line_total_paise)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid gap-1.5 border-t border-[var(--line)] pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--text-muted)]">Items</dt>
            <dd className="font-bold tabular-nums">{formatPaise(order.subtotal_paise)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--text-muted)]">Delivery</dt>
            <dd className="font-bold tabular-nums">
              {order.delivery_fee_paise + order.platform_fee_paise > 0
                ? formatPaise(order.delivery_fee_paise + order.platform_fee_paise)
                : 'Free'}
            </dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-[var(--line)] pt-2">
            <dt className="font-bold">
              {order.payment_mode === 'normal_cod' ? 'Pay on delivery' : 'Total'}
            </dt>
            <dd className="font-display text-lg font-extrabold tabular-nums text-brand-600">
              {formatPaise(order.total_paise)}
            </dd>
          </div>
        </dl>
        <div className="mt-4 border-t border-[var(--line)] pt-3 text-sm">
          <p className="text-xs font-extrabold tracking-[0.14em] text-[var(--text-muted)] uppercase">Delivering to</p>
          <p className="mt-1 font-semibold">
            {address.label}
            {address.recipient && <span className="font-medium text-[var(--text-muted)]"> &middot; {address.recipient}</span>}
          </p>
          <p className="text-[var(--text-muted)]">{addressLine}</p>
          {order.customer_note && <p className="mt-2 text-[var(--text-muted)]">Note: {order.customer_note}</p>}
        </div>
      </section>

      {canCancel(status) && (
        <div className="animate-rise">
          <Button variant="outline" onClick={cancel} loading={busy}>
            Cancel order
          </Button>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            You can cancel until the shop starts preparing.
          </p>
        </div>
      )}
    </div>
  );
}
