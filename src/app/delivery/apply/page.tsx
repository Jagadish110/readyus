import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { serverApi } from '@/lib/api/server';
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

  const me = await serverApi<{ agent: { id: string } | null }>('/v1/rider/me');
  if (!me.ok) throw new Error('We could not load your delivery profile right now. Please try again.');
  if (me.data.agent) redirect('/delivery');

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
