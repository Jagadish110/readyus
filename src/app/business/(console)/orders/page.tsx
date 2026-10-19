import type { Metadata } from 'next';
import { requireShop } from '@/lib/business/shop';
import { OrdersBoard } from '@/components/business/orders-board';
import { FleetPanel } from '@/components/business/fleet-panel';
import { Eyebrow } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

export default async function BusinessOrdersPage() {
  const { shop } = await requireShop();

  return (
    <div className="animate-rise grid gap-6">
      <div>
        <Eyebrow>{shop.shop_name}</Eyebrow>
        <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
          Orders
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          New orders must be accepted within five minutes. This page updates by itself.
        </p>
      </div>
      <OrdersBoard shopId={shop.id} />
      <FleetPanel shopId={shop.id} />
    </div>
  );
}
