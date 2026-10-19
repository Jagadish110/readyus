import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ordersDb, row, rows } from '@/lib/orders/db';
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

  const db = ordersDb(supabase);
  const agent = row<Agent>(
    await db.from('delivery_agents').select('id, full_name, status').eq('user_id', user.id).maybeSingle()
  );
  if (!agent) redirect('/delivery/apply');

  const fleets = rows<{ seller: { shop_name: string } | null }>(
    await db.from('delivery_relationships').select('seller:sellers(shop_name)').eq('agent_id', agent.id).eq('active', 'true')
  );

  return (
    <RiderConsole
      name={agent.full_name}
      fleetNames={fleets.map((fleet) => fleet.seller?.shop_name).filter((name): name is string => Boolean(name))}
    />
  );
}
