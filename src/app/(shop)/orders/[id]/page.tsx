import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/orders/db';
import { serverApi } from '@/lib/api/server';
import type { OrderView } from '@/lib/orders/load';
import { OrderTracker } from '@/components/orders/order-tracker';

export const metadata: Metadata = { title: 'Track your order' };
export const dynamic = 'force-dynamic';

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/orders/${id}`);

  const result = await serverApi<OrderView>(`/v1/orders/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    // Never show a missing order when the real problem is the server.
    throw new Error('We could not load this order right now. Please try again.');
  }
  const initial = result.data;

  return <OrderTracker orderId={id} initial={initial} />;
}
