import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ordersDb, row } from '@/lib/orders/db';
import { DeliveryApplyForm } from '@/components/delivery/apply-form';
import { Eyebrow } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Become a delivery partner' };
export const dynamic = 'force-dynamic';

export default async function DeliveryApplyPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/delivery/apply');

  const agent = row<{ id: string }>(
    await ordersDb(supabase).from('delivery_agents').select('id').eq('user_id', user.id).maybeSingle()
  );
  if (agent) redirect('/delivery');

  return (
    <div className="animate-rise grid gap-5">
      <div>
        <Eyebrow>Delivery partner</Eyebrow>
        <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
          Deliver for shops near you
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          Tell us how to reach you. A shop then gives you a short code that adds you to their delivery
          team, and you can start taking their orders.
        </p>
      </div>
      <DeliveryApplyForm />
    </div>
  );
}
