import type { Metadata } from 'next';
import { requireShop } from '@/lib/business/shop';
import { OrdersBoard } from '@/components/business/orders-board';
import { FleetPanel } from '@/components/business/fleet-panel';
import { CashPanel } from '@/components/business/order-exits';
import { Eyebrow } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Orders' };
export const dynamic = 'force-dynamic';

export default async function BusinessOrdersPage() {
  const { shop } = await requireShop();

  return (
    <div className="animate-rise grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>{shop.shop_name}</Eyebrow>
          <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
            Orders
          </h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--text-muted)]">
            Every order is paid online before it reaches you. Accept it quickly, or it is refunded to the customer. This page updates by itself.
          </p>
        </div>
      </div>

      {/* Adding a rider sits at the top, where the shop decides who delivers. */}
      <details className="group rounded-[26px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block font-display text-base font-extrabold tracking-[-0.025em]">Your delivery team</span>
            <span className="block text-xs text-[var(--text-muted)]">Add a driver, see your riders and their codes.</span>
          </span>
          <span className="shrink-0 rounded-full bg-[var(--leaf-soft)] px-4 py-2 text-sm font-bold text-[var(--leaf-ink)] ring-1 ring-[var(--line)] group-open:hidden">
            + Add driver
          </span>
          <span className="hidden shrink-0 rounded-full bg-[var(--tile)] px-4 py-2 text-sm font-bold ring-1 ring-[var(--line)] group-open:inline">
            Close
          </span>
        </summary>
        <div className="border-t border-[var(--line)] p-2 sm:p-3">
          <FleetPanel />
        </div>
      </details>

      <OrdersBoard />
      <CashPanel />
    </div>
  );
}
