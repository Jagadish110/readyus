'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/orders/errors';
import { ordersDb, rows } from '@/lib/orders/db';
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
  accept_deadline_at: string | null;
  created_at: string;
  customer_note: string;
  delivery_address: { recipient?: string; line1?: string; city?: string };
  order_items: Array<{ name: string; quantity: number }>;
};

const COLUMNS =
  'id, order_code, status, total_paise, payment_mode, required_online_paise, accept_deadline_at, created_at, ' +
  'customer_note, delivery_address, order_items(name, quantity)';

export function OrdersBoard({ shopId }: { shopId: string }) {
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const result = await ordersDb(supabase)
      .from('orders')
      .select(COLUMNS)
      .eq('seller_id', shopId)
      .order('created_at', { ascending: false })
      .limit(60);
    setOrders(rows<SellerOrder>(result));
  }, [shopId]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    refresh();
    const channel = supabase
      .channel(`shop-orders-${shopId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `seller_id=eq.${shopId}` }, () => refresh())
      .subscribe();

    // The live channel is a bonus; polling keeps the board right even when it is unavailable.
    const poll = window.setInterval(() => refresh(), 10_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);

    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [shopId, refresh]);

  async function act(key: string, fn: string, args: Record<string, unknown>) {
    const supabase = createClient();
    if (!supabase) return;
    setBusy(key);
    setError('');
    const result = await ordersDb(supabase).rpc(fn, args);
    setBusy('');
    if (result.error) setError(friendlyError(result.error.message));
    await refresh();
  }

  if (!orders) return <div className="skeleton h-40 rounded-[26px]" />;

  const decide = orders.filter((o) => o.status === 'pending' || o.status === 'payment_confirmed');
  const verify = orders.filter((o) => o.status === 'customer_claimed_paid');
  const waitingPay = orders.filter((o) => o.status === 'payment_required' || o.status === 'payment_rejected');
  const kitchen = orders.filter((o) => o.status === 'accepted' || o.status === 'preparing');
  const onWay = orders.filter((o) => ['packed', 'assigned', 'out_for_delivery'].includes(o.status));
  const recent = orders
    .filter((o) => ['delivered', 'rejected', 'cancelled_by_customer', 'cancelled', 'timed_out'].includes(o.status))
    .slice(0, 8);

  const nothing = !decide.length && !verify.length && !waitingPay.length && !kitchen.length && !onWay.length;

  return (
    <div className="grid gap-6">
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
        {decide.map((order) => {
          const seconds = order.accept_deadline_at
            ? Math.max(0, Math.round((new Date(order.accept_deadline_at).getTime() - now) / 1000))
            : 0;
          return (
            <OrderCard key={order.id} order={order} note={`Accept within ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}>
              <div className="flex flex-wrap gap-2.5">
                <Button
                  variant="leaf"
                  loading={busy === `acc-${order.id}`}
                  onClick={() => act(`acc-${order.id}`, 'seller_decide_order', { p_order: order.id, p_accept: true, p_reason: '' })}
                >
                  Accept
                </Button>
                <Button
                  variant="outline"
                  loading={busy === `dec-${order.id}`}
                  onClick={() => {
                    const reason = window.prompt('Why are you declining? (the customer will see this)', 'Sorry, we cannot take this order right now.');
                    if (reason === null) return;
                    act(`dec-${order.id}`, 'seller_decide_order', { p_order: order.id, p_accept: false, p_reason: reason });
                  }}
                >
                  Decline
                </Button>
              </div>
            </OrderCard>
          );
        })}
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
                onClick={() => act(`pay-${order.id}`, 'verify_payment', { p_order: order.id, p_accept: true })}
              >
                Payment received
              </Button>
              <Button
                variant="outline"
                loading={busy === `nopay-${order.id}`}
                onClick={() => act(`nopay-${order.id}`, 'verify_payment', { p_order: order.id, p_accept: false })}
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
                onClick={() => act(`prep-${order.id}`, 'seller_set_stage', { p_order: order.id, p_stage: 'preparing' })}
              >
                Start preparing
              </Button>
            ) : (
              <Button
                variant="leaf"
                loading={busy === `ready-${order.id}`}
                onClick={() => act(`ready-${order.id}`, 'seller_set_stage', { p_order: order.id, p_stage: 'packed' })}
              >
                Mark ready for pickup
              </Button>
            )}
          </OrderCard>
        ))}
      </Group>

      <Group title="Out of the kitchen" count={onWay.length}>
        {onWay.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            note={
              order.status === 'packed'
                ? 'Waiting for a delivery partner from your team to take it.'
                : order.status === 'assigned'
                  ? 'A delivery partner is coming to collect it.'
                  : 'On its way to the customer.'
            }
          />
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
            {order.payment_mode === 'normal_cod' ? 'Cash on delivery' : 'Paid online'}
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
