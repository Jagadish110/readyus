'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { friendlyError } from '@/lib/orders/errors';
import { STATUS_LABEL, STATUS_TONE, type OrderStatus } from '@/lib/orders/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPaise } from '@/lib/utils';

type SellerOrder = {
  id: string;
  order_code: string;
  status: OrderStatus;
  total_paise: number;
  payment_mode: 'full_prepaid' | 'normal_cod' | 'cod_partial_prepayment';
  required_online_paise: number;
  verified_prepaid_paise: number;
  accept_deadline_at: string | null;
  created_at: string;
  customer_note: string;
  delivery_address: { recipient?: string; line1?: string; city?: string };
  order_items: Array<{ name: string; quantity: number }>;
  /** Who is delivering it, once the shop has chosen. */
  delivery: { agent_id: string; status: 'claimed' | 'picked_up' | 'delivered'; name: string; phone: string } | null;
};

type Partner = { id: string; agent_id: string; agent: { full_name: string; phone: string; vehicle: string } | null };

/** A short two-tone chime, made in the browser so no sound file is needed. */
function chime() {
  try {
    const context = new AudioContext();
    [880, 1175].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + index * 0.18 + 0.4);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + index * 0.18);
      oscillator.stop(context.currentTime + index * 0.18 + 0.45);
    });
  } catch {
    // No audio in this browser; the page title and the list still change.
  }
}

export function OrdersBoard() {
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [declining, setDeclining] = useState<string | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [sound, setSound] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    try {
      setSound(localStorage.getItem('localty-order-sound') === 'on');
    } catch {
      // Storage blocked; sound simply starts off.
    }
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem('localty-order-sound', next ? 'on' : 'off');
    } catch {
      // Not remembered across visits; still works for now.
    }
    // The click is what lets the browser play sound later, so confirm with a chime.
    if (next) chime();
  }

  const refresh = useCallback(async () => {
    const result = await api<{ orders: SellerOrder[] }>('GET', '/v1/seller/orders');
    if (result.ok) setOrders(result.data.orders);
    else setOrders((current) => current ?? []);
    const team = await api<{ partners: Partner[] }>('GET', '/v1/seller/fleet');
    if (team.ok) setPartners(team.data.partners.filter((partner) => partner.agent));
  }, []);

  useEffect(() => {
    void refresh();
    // New orders appear within a few seconds; the board pauses while the tab is hidden.
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 5_000);
    return () => {
      window.clearInterval(poll);
    };
  }, [refresh]);

  async function act(key: string, path: string, body: Record<string, unknown>) {
    setBusy(key);
    setError('');
    const result = await api('POST', path, body);
    setBusy('');
    if (!result.ok) setError(friendlyError(result.error));
    await refresh();
  }

  const decideIds = (orders ?? [])
    .filter((o) => o.status === 'pending' || o.status === 'payment_confirmed')
    .map((o) => o.id)
    .join(',');

  // The tab title carries the count, so a shop with the page open in the background still sees it,
  // and an order that arrives after the first load plays the chime if the owner turned sound on.
  useEffect(() => {
    if (!orders) return;
    const ids = decideIds ? decideIds.split(',') : [];
    document.title = ids.length ? `(${ids.length}) New orders · Localty` : 'Orders · Localty';
    if (seen.current && sound && ids.some((id) => !seen.current!.has(id))) chime();
    seen.current = new Set(ids);
  }, [orders, decideIds, sound]);

  if (!orders) return <div className="skeleton h-40 rounded-[26px]" />;

  const decide = orders.filter((o) => o.status === 'pending' || o.status === 'payment_confirmed');
  const verify = orders.filter((o) => o.status === 'customer_claimed_paid');
  const waitingPay = orders.filter((o) => o.status === 'payment_required' || o.status === 'payment_rejected');
  const kitchen = orders.filter((o) => o.status === 'accepted' || o.status === 'preparing');
  const ready = orders.filter((o) => o.status === 'packed');
  const onWay = orders.filter((o) => ['assigned', 'out_for_delivery'].includes(o.status));
  const recent = orders
    .filter((o) => ['delivered', 'rejected', 'cancelled_by_customer', 'cancelled', 'timed_out'].includes(o.status))
    .slice(0, 8);

  const nothing = !decide.length && !verify.length && !waitingPay.length && !kitchen.length && !ready.length && !onWay.length;

  return (
    <div className="grid gap-6">
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={sound}
        className="justify-self-start rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-bold text-[var(--leaf-ink)] shadow-xs transition-colors hover:bg-[var(--leaf-soft)]"
      >
        {sound ? 'Sound alert on' : 'Turn on sound alert for new orders'}
      </button>
      {error && (
        <p role="alert" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
          {error}
        </p>
      )}

      {nothing && (
        <p className="rounded-[26px] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)] shadow-sm ring-1 ring-[var(--line)]">
          No orders in progress. New orders appear here the moment a customer places one.
        </p>
      )}

      <Group title="Needs your decision" count={decide.length}>
        {decide.map((order) => (
          <OrderCard key={order.id} order={order} note={waitingNote(order, now)}>
            {declining === order.id ? (
              <div className="grid gap-2">
                <p className="text-sm font-bold">Why are you declining? The customer will see this.</p>
                <div className="flex flex-wrap gap-2">
                  {DECLINE_REASONS.map((reason) => (
                    <Button
                      key={reason}
                      size="sm"
                      variant="outline"
                      loading={busy === `dec-${order.id}`}
                      onClick={() => {
                        setDeclining(null);
                        void act(`dec-${order.id}`, `/v1/seller/orders/${order.id}/decide`, { accept: false, reason });
                      }}
                    >
                      {reason}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => setDeclining(null)}>
                    Back
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                <Button
                  variant="leaf"
                  loading={busy === `acc-${order.id}`}
                  onClick={() => act(`acc-${order.id}`, `/v1/seller/orders/${order.id}/decide`, { accept: true, reason: '' })}
                >
                  Accept
                </Button>
                <Button variant="outline" onClick={() => setDeclining(order.id)}>
                  Decline
                </Button>
              </div>
            )}
          </OrderCard>
        ))}
      </Group>

      <Group title="Check the payment" count={verify.length}>
        {verify.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            note={`Customer says they paid ${formatPaise(order.required_online_paise)} by UPI. Check your UPI app before confirming.`}
          >
            <div className="flex flex-wrap gap-2.5">
              <Button
                variant="leaf"
                loading={busy === `pay-${order.id}`}
                onClick={() => act(`pay-${order.id}`, `/v1/seller/orders/${order.id}/verify-payment`, { accept: true })}
              >
                Payment received
              </Button>
              <Button
                variant="outline"
                loading={busy === `nopay-${order.id}`}
                onClick={() => act(`nopay-${order.id}`, `/v1/seller/orders/${order.id}/verify-payment`, { accept: false })}
              >
                Not received
              </Button>
            </div>
          </OrderCard>
        ))}
      </Group>

      <Group title="Preparing" count={kitchen.length}>
        {kitchen.map((order) => (
          <OrderCard key={order.id} order={order}>
            {order.status === 'accepted' ? (
              <Button
                variant="leaf"
                loading={busy === `prep-${order.id}`}
                onClick={() => act(`prep-${order.id}`, `/v1/seller/orders/${order.id}/stage`, { stage: 'preparing' })}
              >
                Start preparing
              </Button>
            ) : (
              <Button
                variant="leaf"
                loading={busy === `ready-${order.id}`}
                onClick={() => act(`ready-${order.id}`, `/v1/seller/orders/${order.id}/stage`, { stage: 'packed' })}
              >
                Mark ready for pickup
              </Button>
            )}
          </OrderCard>
        ))}
      </Group>

      <Group title="Ready: choose who delivers" count={ready.length}>
        {ready.map((order) => (
          <OrderCard key={order.id} order={order} note="Packed. Choose a rider from your team to take it.">
            <RiderPicker
              partners={partners}
              busy={busy === `assign-${order.id}`}
              label="Assign rider"
              onAssign={(agentId) => act(`assign-${order.id}`, `/v1/seller/orders/${order.id}/assign`, { agentId })}
            />
          </OrderCard>
        ))}
      </Group>

      <Group title="Out for delivery" count={onWay.length}>
        {onWay.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            note={
              order.status === 'assigned'
                ? `${order.delivery?.name ?? 'Your rider'} has been told and is coming to collect it.`
                : `${order.delivery?.name ?? 'Your rider'} is on the way to the customer.`
            }
          >
            {order.delivery?.phone && (
              <a href={`tel:${order.delivery.phone}`} className="w-fit text-sm font-bold text-[var(--leaf-ink)] underline">
                Call {order.delivery.name}
              </a>
            )}
            {/* Until the rider has the food, the shop can still hand it to someone else. */}
            {order.status === 'assigned' && (
              <details className="text-sm">
                <summary className="cursor-pointer font-bold text-[var(--leaf-ink)]">Change rider</summary>
                <div className="mt-2">
                  <RiderPicker
                    partners={partners.filter((partner) => partner.agent_id !== order.delivery?.agent_id)}
                    busy={busy === `assign-${order.id}`}
                    label="Change rider"
                    onAssign={(agentId) => act(`assign-${order.id}`, `/v1/seller/orders/${order.id}/assign`, { agentId })}
                  />
                </div>
              </details>
            )}
          </OrderCard>
        ))}
      </Group>

      <Group title="Waiting for the customer to pay" count={waitingPay.length}>
        {waitingPay.map((order) => (
          <OrderCard key={order.id} order={order} note="You will be asked to confirm once they pay." />
        ))}
      </Group>

      <Group title="Recent" count={recent.length}>
        {recent.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </Group>
    </div>
  );
}

/** Pick one of the shop's own riders. With no riders yet, points at where to add them. */
function RiderPicker({
  partners,
  busy,
  label,
  onAssign
}: {
  partners: Partner[];
  busy: boolean;
  label: string;
  onAssign: (agentId: string) => void;
}) {
  const [agentId, setAgentId] = useState('');
  if (partners.length === 0) {
    return (
      <p className="rounded-[16px] bg-warning/12 px-4 py-3 text-sm font-medium ring-1 ring-warning/35">
        You have no riders on your team yet.{' '}
        <a href="#delivery-team" className="font-bold underline">
          Add a rider
        </a>{' '}
        with a rider code, then come back to assign this order.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <select
        value={agentId}
        onChange={(event) => setAgentId(event.target.value)}
        aria-label="Choose a rider"
        className="h-12 min-w-0 flex-1 rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-3.5 text-base font-semibold outline-none focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20"
      >
        <option value="">Choose a rider…</option>
        {partners.map((partner) => (
          <option key={partner.id} value={partner.agent_id}>
            {partner.agent?.full_name} · {partner.agent?.vehicle}
          </option>
        ))}
      </select>
      <Button variant="leaf" loading={busy} disabled={!agentId} onClick={() => onAssign(agentId)}>
        {label}
      </Button>
    </div>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <section className="grid gap-3">
      <h2 className="flex items-center gap-2 text-xs font-extrabold tracking-[0.16em] text-[var(--text-muted)] uppercase">
        {title}
        <span className="rounded-full bg-[var(--leaf-soft)] px-2 py-0.5 text-[0.65rem] text-[var(--leaf-ink)]">{count}</span>
      </h2>
      <ul className="grid gap-3">{children}</ul>
    </section>
  );
}

/** What the owner should believe about the money: never "paid" before it has arrived. */
function paymentLabel(order: SellerOrder) {
  if (order.payment_mode === 'normal_cod') return 'Cash on delivery';
  const paid = order.verified_prepaid_paise >= order.required_online_paise && order.required_online_paise > 0;
  if (!paid) return 'Online payment pending';
  const rest = order.total_paise - order.verified_prepaid_paise;
  return rest > 0 ? `Part paid online · collect ${formatPaise(rest)} cash` : 'Paid online';
}

/** How long an order has waited, and for orders paid online, how long until they are refunded. */
function waitingNote(order: SellerOrder, now: number) {
  const waited = Math.max(0, Math.floor((now - new Date(order.created_at).getTime()) / 60_000));
  const parts = [waited < 1 ? 'Just now' : `Waiting ${waited} min`];
  if (order.verified_prepaid_paise > 0 && order.accept_deadline_at) {
    const left = Math.ceil((new Date(order.accept_deadline_at).getTime() - now) / 60_000);
    parts.push(left > 0 ? `paid online: accept within ${left} min or it is refunded` : 'paid online: refund pending');
  }
  return parts.join(' · ');
}

const DECLINE_REASONS = [
  'An item is sold out',
  'We are too busy right now',
  'We are closing soon',
  'Sorry, we cannot take this order'
];

function OrderCard({
  order,
  note,
  children
}: {
  order: SellerOrder;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="grid gap-3 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-base font-extrabold tracking-[-0.025em]">{order.order_code}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {order.delivery_address.recipient || 'Customer'} &middot;{' '}
            {new Date(order.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} &middot;{' '}
            {paymentLabel(order)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
      </div>
      <ul className="grid gap-0.5 text-sm">
        {order.order_items.map((item) => (
          <li key={item.name}>
            {item.quantity} &times; {item.name}
          </li>
        ))}
      </ul>
      {order.customer_note && (
        <p className="rounded-[16px] bg-[var(--tile)] px-3.5 py-2.5 text-sm">Note: {order.customer_note}</p>
      )}
      <p className="text-sm font-extrabold tabular-nums text-brand-600">{formatPaise(order.total_paise)}</p>
      {note && <p className="text-xs font-semibold text-[var(--text-muted)]">{note}</p>}
      {children}
    </li>
  );
}
