import type { Metadata } from 'next';
import { Eyebrow } from '@/components/ui/card';
import { OrdersDesk } from '@/components/admin/orders-desk';

export const metadata: Metadata = { title: 'Orders' };

export default function OrdersPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8 sm:py-12">
      <div className="animate-rise">
        <Eyebrow>Admin</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">Orders</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Find any order, see what happened to it, settle customer problems and refund money.</p>
      </div>
      <OrdersDesk />
    </div>
  );
}
