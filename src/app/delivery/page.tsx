import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { serverApi } from '@/lib/api/server';
import { RiderConsole } from '@/components/delivery/rider-console';

export const metadata: Metadata = { title: 'Delivery' };
export const dynamic = 'force-dynamic';

type Agent = { id: string; full_name: string; status: string };

export default async function DeliveryPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/delivery');

  const me = await serverApi<{ agent: Agent | null; fleets: string[] }>('/v1/rider/me');
  if (!me.ok) throw new Error('We could not load your delivery profile right now. Please try again.');
  const { agent, fleets } = me.data;
  if (!agent) redirect('/delivery/apply');

  return (
    <RiderConsole
      name={agent.full_name}
      fleetNames={fleets}
    />
  );
}
