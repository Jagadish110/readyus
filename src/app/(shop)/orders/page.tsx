import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { serverApi } from '@/lib/api/server';
import { isActive } from '@/lib/orders/status';
import { AutoRefresh } from '@/components/orders/auto-refresh';
import { OrderHistory, type ListedOrder } from '@/components/orders/order-history';
import { ButtonLink } from '@/components/ui/button';
import { Dish } from '@/components/art/dish-photo';

export const metadata: Metadata = { title: 'Your orders' };
export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/orders');

  const result = await serverApi<{ orders: ListedOrder[]; server_now?: string }>('/v1/orders');
  // An outage must not look like an empty order history.
  if (!result.ok) throw new Error('We could not load your orders right now. Please try again.');
  const orders = result.data.orders;

  return (
    <div className="mx-auto grid max-w-2xl grid-cols-1 gap-6">
      {orders.some((order) => isActive(order.status)) && <AutoRefresh />}
      <h1 className="animate-rise font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">
        Your orders
      </h1>

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

      <OrderHistory orders={orders} serverNow={result.data.server_now} />
    </div>
  );
}
