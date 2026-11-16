import Image from 'next/image';
import Link from 'next/link';
import { isActive, STATUS_LABEL, STATUS_TONE, stepOf, TIMELINE, type OrderStatus } from '@/lib/orders/status';
import { cn, formatPaise } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { NoPhoto } from '@/components/marketplace/no-photo';
import { PayNow } from './pay-now';
import { AcceptTimer } from './accept-timer';

export type ListedOrder = {
  id: string;
  order_code?: string;
  status: OrderStatus;
  payment_mode?: 'full_prepaid' | 'normal_cod' | 'cod_partial_prepayment';
  subtotal_paise?: number;
  delivery_fee_paise?: number;
  total_paise: number;
  cancel_reason?: string;
  accepted_at?: string | null;
  accept_deadline_at?: string | null;
  pay_deadline_at?: string | null;
  created_at: string;
  seller: { shop_name: string } | null;
  order_items: Array<{
    name: string;
    quantity: number;
    variant_label?: string;
    image_url?: string | null;
    unit_price_paise?: number;
    line_total_paise?: number;
  }>;
};

// This page renders on the server, which does not run on Indian time.
const TIME_ZONE = 'Asia/Kolkata';

const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date);

const clock = (date: Date) =>
  date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });

function dayLabel(date: Date, now: Date) {
  if (dayKey(date) === dayKey(now)) return 'Today';
  if (dayKey(date) === dayKey(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: TIME_ZONE,
    ...(dayKey(date).slice(0, 4) === dayKey(now).slice(0, 4) ? {} : { year: 'numeric' as const })
  });
}

const summaryOf = (order: ListedOrder) => order.order_items.map((item) => `${item.quantity} × ${item.name}`).join(', ');

const needsPayment = (order: ListedOrder) => order.status === 'payment_required' || order.status === 'payment_rejected';

/** Orders still moving come first and big, since they may need the customer; the past is a quiet list by day. */
export function OrderHistory({ orders, serverNow }: { orders: ListedOrder[]; serverNow?: string }) {
  const now = new Date();
  // Anything waiting on the customer's payment goes to the very top.
  const live = orders.filter((order) => isActive(order.status)).sort((a, b) => Number(needsPayment(b)) - Number(needsPayment(a)));
  const past = orders.filter((order) => !isActive(order.status));

  const days = new Map<string, { label: string; orders: ListedOrder[] }>();
  for (const order of past) {
    const date = new Date(order.created_at);
    const day = days.get(dayKey(date)) ?? { label: dayLabel(date, now), orders: [] };
    day.orders.push(order);
    days.set(dayKey(date), day);
  }

  return (
    <>
      {live.length > 0 && (
        <section className="animate-rise grid grid-cols-1 gap-3">
          <SectionTitle>In progress</SectionTitle>
          <ul className="grid grid-cols-1 gap-3">
            {live.map((order) => (
              <li key={order.id}>
                <LiveCard order={order} serverNow={serverNow} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {days.size > 0 && (
        <section className="animate-rise grid grid-cols-1 gap-5 [animation-delay:60ms]">
          {live.length > 0 && <SectionTitle>Past orders</SectionTitle>}
          {[...days.entries()].map(([key, day]) => (
            <div key={key} className="grid grid-cols-1 gap-2.5">
              <h3 className="px-1 text-sm font-bold text-[var(--text-muted)]">{day.label}</h3>
              <ul className="grid grid-cols-1 gap-3">
                {day.orders.map((order) => (
                  <li key={order.id}>
                    <PastCard order={order} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-extrabold tracking-[0.16em] text-[var(--text-muted)] uppercase">{children}</h2>;
}

function LiveCard({ order, serverNow }: { order: ListedOrder; serverNow?: string }) {
  // A shop that accepted stays accepted while the customer pays, as on the order page.
  const step = Math.max(stepOf(order.status), order.accepted_at ? 1 : 0);
  // While the shop has not answered, the customer sees how long it still has.
  const waiting = order.status === 'pending' || (order.status === 'payment_confirmed' && !order.accepted_at);
  const summary = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[var(--leaf-ink)]">{order.seller?.shop_name ?? 'Shop'}</p>
          <p className="mt-1 font-display text-2xl leading-[1.15] font-extrabold tracking-[-0.035em]">{STATUS_LABEL[order.status]}</p>
        </div>
        {waiting && <AcceptTimer deadline={order.accept_deadline_at} placedAt={order.created_at} serverNow={serverNow} />}
      </div>

      <div aria-hidden className="mt-3.5 grid grid-cols-6 gap-1">
        {TIMELINE.map((entry, index) => (
          <span
            key={entry.key}
            className={cn(
              'h-1.5 rounded-full',
              index < step && 'bg-leaf-600',
              index === step && 'animate-pulse bg-leaf-500',
              index > step && 'bg-ink-300/40'
            )}
          />
        ))}
      </div>

      <p className="mt-3.5 truncate text-sm text-[var(--text-muted)]">{summaryOf(order)}</p>
    </>
  );

  // The Pay button opens Cashfree right here, so only the top of this card links to the order.
  if (needsPayment(order)) {
    return (
      <div className="rounded-[26px] bg-[var(--leaf-soft)] p-5 ring-1 ring-[var(--line)]">
        <Link href={`/orders/${order.id}`} transitionTypes={['nav-forward']} className="block">
          {summary}
        </Link>
        <PayNow
          orderId={order.id}
          totalPaise={order.total_paise}
          placedAt={clock(new Date(order.created_at))}
          deadline={order.pay_deadline_at}
          serverNow={serverNow}
        />
      </div>
    );
  }

  return (
    <Link
      href={`/orders/${order.id}`}
      transitionTypes={['nav-forward']}
      className="block rounded-[26px] bg-[var(--leaf-soft)] p-5 ring-1 ring-[var(--line)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:ring-leaf-400 active:scale-[0.98] active:duration-100"
    >
      {summary}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm">
          <span className="font-extrabold tabular-nums">{formatPaise(order.total_paise)}</span>
          <span className="text-[var(--text-muted)]"> &middot; {clock(new Date(order.created_at))}</span>
        </p>
        <span className="shrink-0 text-sm font-bold text-[var(--leaf-ink)]">Track order &rsaquo;</span>
      </div>
    </Link>
  );
}

const PAID_BY: Record<NonNullable<ListedOrder['payment_mode']>, string> = {
  full_prepaid: 'Paid online',
  normal_cod: 'Cash on delivery',
  cod_partial_prepayment: 'Part online, part cash'
};

/** A finished order, laid out like the cart and the shop's order card: the shop, each line, the total. */
function PastCard({ order }: { order: ListedOrder }) {
  const tone = STATUS_TONE[order.status];
  const delivered = order.status === 'delivered';
  const delivery = order.delivery_fee_paise ?? 0;
  return (
    <Link
      href={`/orders/${order.id}`}
      transitionTypes={['nav-forward']}
      className="grid gap-4 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:ring-leaf-400 active:scale-[0.99] active:duration-100"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.64rem] font-bold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">
            {order.order_code ? `${order.order_code} · ` : ''}
            {clock(new Date(order.created_at))}
          </p>
          <h4 className="line-clamp-2 font-display text-xl leading-tight font-extrabold tracking-[-0.03em]">{order.seller?.shop_name ?? 'Shop'}</h4>
        </div>
        <Badge tone={tone} className="shrink-0">
          {STATUS_LABEL[order.status]}
        </Badge>
      </header>

      <ul className="grid gap-2.5">
        {order.order_items.map((item, index) => (
          <li key={`${item.name}-${item.variant_label ?? ''}-${index}`} className="flex gap-3 rounded-[18px] bg-[var(--tile)] p-2.5 ring-1 ring-[var(--line)]">
            <span aria-hidden className="relative block size-14 shrink-0 overflow-hidden rounded-[14px] bg-[var(--surface)]">
              {item.image_url ? (
                <Image src={item.image_url} alt="" fill sizes="56px" className="object-cover" />
              ) : (
                <NoPhoto name={item.name} />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="line-clamp-2 text-[0.92rem] leading-snug font-bold">
                {item.name}
                {item.variant_label && <span className="font-semibold text-[var(--text-muted)]"> &middot; {item.variant_label}</span>}
              </p>
              <div className="mt-auto flex items-end justify-between gap-2 pt-1">
                <p className="text-sm font-semibold text-[var(--text-muted)] tabular-nums">
                  {item.unit_price_paise !== undefined && `${formatPaise(item.unit_price_paise)} × `}
                  <span className="font-extrabold text-[var(--text)]">{item.quantity}</span>
                </p>
                {item.line_total_paise !== undefined && (
                  <p className="font-display font-extrabold tabular-nums">{formatPaise(item.line_total_paise)}</p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <dl className="grid gap-1.5 px-1 text-sm">
        {order.order_items.length > 1 && order.subtotal_paise !== undefined && (
          <div className="flex items-center justify-between">
            <dt className="font-semibold text-[var(--text-muted)]">Subtotal</dt>
            <dd className="font-display font-extrabold tabular-nums">{formatPaise(order.subtotal_paise)}</dd>
          </div>
        )}
        {order.delivery_fee_paise !== undefined && (
          <div className="flex items-center justify-between">
            <dt className="font-semibold text-[var(--text-muted)]">Delivery</dt>
            <dd className="font-bold">{delivery > 0 ? formatPaise(delivery) : <span className="text-[var(--leaf-ink)]">Free</span>}</dd>
          </div>
        )}
        <div className="flex items-center justify-between">
          <dt className="font-bold">
            Total
            {order.payment_mode && <span className="font-semibold text-[var(--text-muted)]"> &middot; {PAID_BY[order.payment_mode]}</span>}
          </dt>
          <dd className={cn('font-display text-base font-extrabold tabular-nums', delivered ? 'text-brand-600' : 'text-[var(--text-muted)]')}>
            {formatPaise(order.total_paise)}
          </dd>
        </div>
      </dl>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3 text-sm">
        <p className={cn('min-w-0 truncate', tone === 'danger' ? 'font-semibold text-danger' : 'text-[var(--text-muted)]')}>
          {delivered ? 'Delivered' : order.cancel_reason || STATUS_LABEL[order.status]}
        </p>
        <span className="shrink-0 font-bold text-[var(--leaf-ink)]">View order &rsaquo;</span>
      </div>
    </Link>
  );
}
