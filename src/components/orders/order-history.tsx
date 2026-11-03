import Link from 'next/link';
import { isActive, STATUS_LABEL, STATUS_TONE, stepOf, TIMELINE, type OrderStatus } from '@/lib/orders/status';
import { cn, formatPaise } from '@/lib/utils';

export type ListedOrder = {
  id: string;
  status: OrderStatus;
  total_paise: number;
  accepted_at?: string | null;
  created_at: string;
  seller: { shop_name: string } | null;
  order_items: Array<{ name: string; quantity: number }>;
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
export function OrderHistory({ orders }: { orders: ListedOrder[] }) {
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
                <LiveCard order={order} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {days.size > 0 && (
        <section className="animate-rise grid grid-cols-1 gap-5 [animation-delay:60ms]">
          {live.length > 0 && <SectionTitle>Past orders</SectionTitle>}
          {[...days.entries()].map(([key, day]) => (
            <div key={key} className="grid grid-cols-1 gap-2">
              <h3 className="px-1 text-sm font-bold text-[var(--text-muted)]">{day.label}</h3>
              <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-[22px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]">
                {day.orders.map((order) => (
                  <li key={order.id}>
                    <PastRow order={order} />
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

function LiveCard({ order }: { order: ListedOrder }) {
  // A shop that accepted stays accepted while the customer pays, as on the order page.
  const step = Math.max(stepOf(order.status), order.accepted_at ? 1 : 0);
  return (
    <Link
      href={`/orders/${order.id}`}
      transitionTypes={['nav-forward']}
      className="block rounded-[26px] bg-[var(--leaf-soft)] p-5 ring-1 ring-[var(--line)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:ring-leaf-400 active:scale-[0.98] active:duration-100"
    >
      <p className="truncate text-sm font-bold text-[var(--leaf-ink)]">{order.seller?.shop_name ?? 'Shop'}</p>
      <p className="mt-1 font-display text-2xl leading-[1.15] font-extrabold tracking-[-0.035em]">{STATUS_LABEL[order.status]}</p>

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

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm">
          <span className="font-extrabold tabular-nums">{formatPaise(order.total_paise)}</span>
          <span className="text-[var(--text-muted)]"> &middot; {clock(new Date(order.created_at))}</span>
        </p>
        {needsPayment(order) ? (
          <span className="inline-flex h-10 shrink-0 items-center rounded-full bg-brand-600 px-5 text-sm font-bold text-white">Pay now</span>
        ) : (
          <span className="shrink-0 text-sm font-bold text-[var(--leaf-ink)]">Track order &rsaquo;</span>
        )}
      </div>
    </Link>
  );
}

const MARK = {
  success: { glyph: '✓', className: 'bg-leaf-600 text-white' },
  danger: { glyph: '!', className: 'bg-danger/15 text-danger' },
  neutral: { glyph: '×', className: 'bg-[var(--tile)] text-[var(--text-muted)]' }
};

function PastRow({ order }: { order: ListedOrder }) {
  const tone = STATUS_TONE[order.status];
  const mark = tone === 'success' || tone === 'danger' ? MARK[tone] : MARK.neutral;
  const delivered = order.status === 'delivered';
  return (
    <Link
      href={`/orders/${order.id}`}
      transitionTypes={['nav-forward']}
      className="flex items-center gap-3.5 p-4 transition-colors hover:bg-[var(--tile)] focus-visible:bg-[var(--tile)]"
    >
      <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-full text-sm font-extrabold', mark.className)}>
        {mark.glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate font-display text-[0.95rem] font-extrabold tracking-[-0.02em]">{order.seller?.shop_name ?? 'Shop'}</span>
          <span className={cn('shrink-0 text-sm font-bold tabular-nums', !delivered && 'font-semibold text-[var(--text-muted)]')}>
            {formatPaise(order.total_paise)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-sm text-[var(--text-muted)]">{summaryOf(order)}</span>
        <span className="mt-0.5 block truncate text-xs font-medium text-[var(--text-muted)]">
          <span className={cn(tone === 'danger' && 'font-bold text-danger')}>{STATUS_LABEL[order.status]}</span> &middot; {clock(new Date(order.created_at))}
        </span>
      </span>
      <span aria-hidden className="shrink-0 text-xl leading-none text-[var(--text-muted)]">
        &rsaquo;
      </span>
    </Link>
  );
}
