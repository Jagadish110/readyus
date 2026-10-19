import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ordersDb, rows } from '@/lib/orders/db';
import { isActive, STATUS_LABEL, STATUS_TONE, type OrderStatus } from '@/lib/orders/status';
import { AutoRefresh } from '@/components/orders/auto-refresh';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { Dish } from '@/components/art/dish-photo';
import { formatPaise } from '@/lib/utils';

export const metadata: Metadata = { title: 'Your orders' };
export const dynamic = 'force-dynamic';

type ListedOrder = {
  id: string;
  order_code: string;
  status: OrderStatus;
  total_paise: number;
  created_at: string;
  seller: { shop_name: string } | null;
  order_items: Array<{ name: string; quantity: number }>;
};

export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/orders');

  const result = await ordersDb(supabase)
    .from('orders')
    .select('id, order_code, status, total_paise, created_at, seller:sellers(shop_name), order_items(name, quantity)')
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  const orders = rows<ListedOrder>(result);

  const live = orders.filter((order) => isActive(order.status));
  const past = orders.filter((order) => !isActive(order.status));

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      {live.length > 0 && <AutoRefresh />}
      <div className="animate-rise">
        <Eyebrow>Your orders</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">
          Orders
        </h1>
      </div>

      {orders.length === 0 && (
        <div className="animate-rise rounded-[30px] bg-[var(--surface)] p-9 text-center shadow-sm ring-1 ring-[var(--line)]">
          <span aria-hidden className="relative mx-auto block size-28 overflow-hidden rounded-full bg-[var(--tile)]">
            <Dish name="kirana" sizes="112px" />
          </span>
          <h2 className="mt-4 font-display text-xl font-extrabold tracking-[-0.03em]">No orders yet</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            When you order, you can follow it here minute by minute.
          </p>
          <ButtonLink href="/browse" variant="leaf" size="lg" className="mt-6">
            Browse nearby shops
          </ButtonLink>
        </div>
      )}

      {live.length > 0 && <Section title="In progress" orders={live} />}
      {past.length > 0 && <Section title="Earlier" orders={past} />}
    </div>
  );
}

function Section({ title, orders }: { title: string; orders: ListedOrder[] }) {
  return (
    <section className="animate-rise grid gap-3">
      <h2 className="text-xs font-extrabold tracking-[0.16em] text-[var(--text-muted)] uppercase">{title}</h2>
      <ul className="grid gap-3">
        {orders.map((order) => {
          const summary = order.order_items.map((item) => `${item.quantity} × ${item.name}`).join(', ');
          return (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="block rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:ring-leaf-400"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-extrabold tracking-[-0.025em]">
                      {order.seller?.shop_name ?? 'Shop'}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {order.order_code} &middot;{' '}
                      {new Date(order.created_at).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[order.status]} className="shrink-0">
                    {STATUS_LABEL[order.status]}
                  </Badge>
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-[var(--text-muted)]">{summary}</p>
                <p className="mt-3 text-sm font-extrabold tabular-nums text-brand-600">
                  {formatPaise(order.total_paise)}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
