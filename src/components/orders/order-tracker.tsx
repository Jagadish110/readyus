'use client';

import { OrderHelp } from './order-help';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import { friendlyError } from '@/lib/orders/errors';
import type { OrderView } from '@/lib/orders/load';
import {
  canCancel,
  etaFor,
  formatClock,
  isActive,
  isEnded,
  minutesLeft,
  PAY_WINDOW_SECONDS,
  STATUS_LABEL,
  stepOf,
  timeAgo,
  TIMELINE,
  type OrderStatus
} from '@/lib/orders/status';
import { payForOrder } from '@/lib/payments/checkout';
import { Countdown, useSecondsLeft } from './countdown';
import { LiveMap } from '@/components/maps/live-map';
import { ReviewForm } from './review-form';
import { Button, ButtonLink } from '@/components/ui/button';
import { cn, formatPaise } from '@/lib/utils';
import { comboSummary } from '@/lib/menu';

/**
 * Keeps one order current by asking the backend every few seconds while the
 * order is in progress (and the tab is visible). `live` is false when the
 * last check failed.
 */
function useLiveOrder(orderId: string, initial: OrderView) {
  const [view, setView] = useState(initial);
  const [live, setLive] = useState(true);

  const refetch = useCallback(async () => {
    const result = await api<OrderView>('GET', `/v1/orders/${orderId}`);
    if (result.ok) {
      setView(result.data);
      setLive(true);
    } else {
      setLive(false);
    }
  }, [orderId]);

  const watching = isActive(view.order.status);
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refetch();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [watching, refetch]);

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
  const now = useNow(15_000);
  const payLeft = useSecondsLeft(order.pay_deadline_at, view.server_now);
  const payTimeOver = payLeft === 0;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  // Set when the shop has no payout account yet, so only manual UPI is possible.
  const [upiOnly, setUpiOnly] = useState(false);

  // Hide the online Pay button for a shop whose payout details are not verified yet.
  const sellerId = order.seller?.id;
  useEffect(() => {
    if (!sellerId) return;
    api<{ ready: string[] }>('GET', `/v1/shops/online?ids=${sellerId}`).then((result) => {
      if (result.ok && !result.data.ready.includes(sellerId)) setUpiOnly(true);
    });
  }, [sellerId]);

  const prep = order.seller?.eta_minutes ?? 15;
  const eta = useMemo(() => etaFor(order, prep), [order, prep]);
  const left = minutesLeft(eta.at, now);
  // A shop that accepted stays accepted while the customer pays.
  const step = Math.max(stepOf(status), order.accepted_at ? 1 : 0);
  const ended = isEnded(status);
  const shopName = order.seller?.shop_name ?? 'the shop';

  async function run(call: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError('');
    const result = await call();
    setBusy(false);
    if (!result.ok && result.error) setError(friendlyError(result.error));
    await refetch();
  }

  const cancel = () => {
    if (!window.confirm('Cancel this order?')) return;
    run(() => api('POST', `/v1/orders/${orderId}/cancel`));
  };

  const claimPaid = () => {
    run(() => api('POST', `/v1/orders/${orderId}/claim-payment`, { reference: reference.trim() }));
  };

  const payOnline = async () => {
    setBusy(true);
    setError('');
    const result = await payForOrder(orderId);
    setBusy(false);
    if (!result.ok) {
      if (result.shopNotReady) setUpiOnly(true);
      if (result.error) setError(result.error);
    }
    await refetch();
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

  const paidOnline = order.verified_prepaid_paise > 0;
  const hero = heroCopy(order, shopName, map?.rider_name ?? null, eta.minutes);
  // An arrival time only means something once the shop has taken the order and it is paid for.
  const showEta =
    ['accepted', 'preparing', 'packed', 'assigned', 'out_for_delivery'].includes(status) ||
    (status === 'payment_confirmed' && Boolean(order.accepted_at));

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="grid gap-5">
        <div className="animate-rise">
          <Link
            href="/orders"
            transitionTypes={['nav-back']}
            className="-ml-1 inline-flex h-11 items-center rounded-full px-1 text-sm font-bold text-[var(--leaf-ink)] hover:underline"
          >
            &larr; All orders
          </Link>

          {/* What is happening now, when it arrives and how far along it is, all in one place. */}
          <section
            className={cn(
              'mt-1 rounded-[26px] p-5 ring-1 sm:p-6',
              ended ? 'bg-danger/10 ring-danger/30' : 'bg-[var(--leaf-soft)] ring-[var(--line)]'
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                {sellerId ? (
                  <Link href={`/shop/${sellerId}`} className="text-sm font-bold text-[var(--leaf-ink)] hover:underline">
                    {shopName}
                  </Link>
                ) : (
                  <p className="text-sm font-bold text-[var(--leaf-ink)]">{shopName}</p>
                )}
                <h1 className="mt-1.5 font-display text-[clamp(1.5rem,4vw,2rem)] leading-[1.1] font-extrabold tracking-[-0.04em]">
                  {hero.title}
                </h1>
              </div>
              {showEta && (
                <p className="shrink-0 rounded-[18px] bg-[var(--surface)] px-4 py-2.5 text-center shadow-sm ring-1 ring-[var(--line)]">
                  <span className="block font-display text-2xl leading-none font-extrabold tracking-[-0.04em] whitespace-nowrap tabular-nums">
                    {left > 0 ? `${left} min` : 'Soon'}
                  </span>
                  <span className="mt-1 block text-xs font-semibold text-[var(--text-muted)]">by {formatClock(eta.at)}</span>
                </p>
              )}
            </div>

            <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
              {ended ? (
                <>
                  <span className="block">{order.cancel_reason || 'This order will not be delivered.'}</span>
                  {paidOnline && (
                    <span className="mt-1 block">
                      {status === 'delivery_failed'
                        ? 'This was not refunded automatically. If that is wrong, report a problem and we will look at it.'
                        : 'Your online payment is refunded to the account you paid from.'}
                    </span>
                  )}
                </>
              ) : (
                hero.detail
              )}
            </p>

            {(status === 'payment_required' || status === 'payment_rejected') && (
              <div className="mt-4 grid gap-3">
                {status === 'payment_rejected' && (
                  <p className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
                    The shop could not find your payment. Check the amount and UPI ID, then try again.
                  </p>
                )}
                {order.pay_deadline_at && (
                  <Countdown
                    label="Time left to pay"
                    left={payLeft}
                    totalSeconds={PAY_WINDOW_SECONDS}
                    expired="Time is up. This order is being cancelled."
                  />
                )}
                {upiOnly ? (
                  // Only a shop that cannot take online payments yet is paid by hand.
                  <div>
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
                            className="mt-3 inline-flex h-11 items-center rounded-full bg-[var(--surface)] px-5 text-sm font-bold text-[var(--leaf-ink)] ring-1 ring-[var(--line)] md:hidden"
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
                    <Button variant="leaf" fullWidth className="mt-3" onClick={claimPaid} loading={busy} disabled={payTimeOver}>
                      I have paid
                    </Button>
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      The shop confirms the money has arrived before they start. This does not charge you.
                    </p>
                  </div>
                ) : (
                  <div>
                    <Button size="lg" fullWidth onClick={payOnline} loading={busy} disabled={payTimeOver}>
                      Pay {formatPaise(order.required_online_paise)} securely
                    </Button>
                    <p className="mt-2 text-center text-xs text-[var(--text-muted)]">
                      UPI, cards and net banking. The money goes straight to {shopName}.
                    </p>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-4 rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
                {error}
              </p>
            )}

            {ended ? (
              <ButtonLink href="/browse" variant="leaf-outline" size="sm" className="mt-4">
                Find another shop
              </ButtonLink>
            ) : (
              <ProgressSteps step={step} delivered={status === 'delivered'} />
            )}

            {isActive(status) && !live && (
              <p role="status" className="mt-3 text-xs font-semibold text-[var(--text-muted)]">
                Reconnecting. This page updates by itself.
              </p>
            )}
          </section>
        </div>

        {/* The code is only for the handover, so it stays out of the way until the rider has the order. */}
        {code && status === 'out_for_delivery' && (
          <section className="animate-rise flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[26px] border-2 border-dashed border-leaf-300 bg-[var(--surface)] p-5">
            <div className="min-w-0 flex-1 basis-52">
              <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">Delivery code</h2>
              <p className="mt-0.5 text-sm text-[var(--text-muted)]">Tell this to your rider when they arrive. Do not share it before.</p>
            </div>
            <p
              aria-label={`Delivery code ${code.split('').join(' ')}`}
              className="font-display text-3xl font-extrabold tracking-[0.2em] tabular-nums"
            >
              {code}
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

        {status === 'delivered' && (
          <ReviewForm
            orderId={orderId}
            shopName={shopName}
            items={items}
            existing={reviews}
            onSaved={refetch}
          />
        )}

        {/* The times behind the progress bar, for anyone who wants them. */}
        {!ended && (
          <details className="group animate-rise rounded-[26px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 font-display text-base font-extrabold tracking-[-0.025em] [&::-webkit-details-marker]:hidden">
              Order timeline
              <span aria-hidden className="text-xl leading-none text-[var(--text-muted)] transition-transform group-open:rotate-90">
                &rsaquo;
              </span>
            </summary>
            <ol className="grid gap-0 px-5 pt-1 pb-5">
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
          </details>
        )}
      </div>

      <aside className="grid gap-5 lg:mt-12">
        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] [animation-delay:60ms]">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Your items</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {item.quantity} &times; {item.name}
                  {item.variant_label && <span className="text-[var(--text-muted)]"> ({item.variant_label})</span>}
                  {item.combo_items?.length ? (
                    <span className="block text-xs text-[var(--text-muted)]">Includes {comboSummary(item.combo_items)}</span>
                  ) : null}
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

        {/* The status card above already says why an ended order ended. */}
        <OrderHelp
          orderId={orderId}
          status={status}
          shopPhone={order.seller?.phone ?? null}
          cancelReason=""
          paidOnline={paidOnline}
        />

        {canCancel(status) && (
          <div className="animate-rise text-center">
            <Button variant="ghost" size="sm" className="text-danger" onClick={cancel} loading={busy}>
              Cancel order
            </Button>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              You can cancel until the shop starts preparing.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

/** The headline and one line of detail for where an order is right now. */
function heroCopy(
  order: OrderView['order'],
  shopName: string,
  riderName: string | null,
  etaMinutes: number
): { title: string; detail: string } {
  const accepted = Boolean(order.accepted_at);
  switch (order.status) {
    case 'pending':
      return {
        title: `Waiting for ${shopName} to accept`,
        detail: `You will see it here the moment they accept. ${
          order.required_online_paise > order.verified_prepaid_paise ? 'Then you pay here, and they start preparing it. ' : ''
        }Delivery usually takes about ${etaMinutes} minutes after that.`
      };
    case 'payment_required':
    case 'payment_rejected':
      return accepted
        ? {
            title: 'Accepted! Pay now to confirm',
            detail: 'They start preparing it as soon as you pay. If the timer runs out, the order is cancelled.'
          }
        : { title: 'Pay to start your order', detail: 'The shop gets your order once your payment goes through.' };
    case 'customer_claimed_paid':
      return { title: 'The shop is checking your payment', detail: 'They start preparing it once they see the money arrive.' };
    case 'payment_confirmed':
      return accepted
        ? { title: 'Payment received', detail: `${shopName} will start preparing your order now.` }
        : { title: `Waiting for ${shopName} to accept`, detail: 'Your payment is received. You will see it here the moment they accept.' };
    case 'accepted':
      return { title: 'Your order is accepted', detail: `${shopName} will start preparing it shortly.` };
    case 'preparing':
      return { title: 'Your order is being prepared', detail: `${shopName} is working on it now.` };
    case 'packed':
      return { title: 'Packed and ready', detail: 'Waiting for a delivery partner to pick it up.' };
    case 'assigned':
      return {
        title: `${riderName ?? 'A rider'} is heading to the shop`,
        detail: 'The live map appears once they pick up your order.'
      };
    case 'out_for_delivery':
      return { title: 'On the way to you', detail: `${riderName ?? 'Your rider'} has picked up your order.` };
    case 'delivered':
      return {
        title: 'Delivered. Enjoy!',
        detail: order.delivered_at ? `Arrived at ${formatClock(new Date(order.delivered_at))}.` : 'Your order has arrived.'
      };
    default:
      return { title: STATUS_LABEL[order.status], detail: '' };
  }
}

/** One segment per stage, filled up to where the order is, so progress reads at a glance. */
function ProgressSteps({ step, delivered }: { step: number; delivered: boolean }) {
  return (
    <div className="mt-5">
      <ol className="grid grid-cols-6 gap-1">
        {TIMELINE.map((entry, index) => {
          const done = delivered || index < step;
          const current = !delivered && index === step;
          return (
            <li key={entry.key} aria-current={current ? 'step' : undefined} className="min-w-0">
              <span
                aria-hidden
                className={cn(
                  'block h-1.5 rounded-full',
                  done && 'bg-leaf-600',
                  current && 'animate-pulse bg-leaf-500',
                  !done && !current && 'bg-ink-300/40'
                )}
              />
              <span
                className={cn(
                  'mt-1.5 hidden truncate text-xs leading-tight font-semibold sm:block',
                  current ? 'font-extrabold text-[var(--leaf-ink)]' : 'text-[var(--text-muted)]'
                )}
              >
                {entry.label === 'Order placed' ? 'Placed' : entry.label}
              </span>
            </li>
          );
        })}
      </ol>
      {/* Six labels do not fit a phone, so there it names only the stage the order is at. */}
      <p className="mt-2 text-xs font-semibold text-[var(--text-muted)] sm:hidden">
        <span className="font-extrabold text-[var(--leaf-ink)]">{delivered ? 'Delivered' : TIMELINE[step].label}</span>
        {!delivered && ` · Step ${step + 1} of ${TIMELINE.length}`}
      </p>
    </div>
  );
}
