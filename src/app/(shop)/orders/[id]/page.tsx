import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/orders/db';
import { loadOrder } from '@/lib/orders/load';
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

  const initial = await loadOrder(supabase, id);
  if (!initial || !user) notFound();

  return <OrderTracker orderId={id} initial={initial} />;
}
