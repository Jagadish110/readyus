import type { Metadata } from 'next';
import { Eyebrow } from '@/components/ui/card';
import { ShopsDirectory } from '@/components/admin/directories';

export const metadata: Metadata = { title: 'Shops' };

export default function ShopsPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8 sm:py-12">
      <div className="animate-rise">
        <Eyebrow>Admin</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">Shops</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Pausing a shop hides it from customers at once and stops new orders. Orders already in progress can still finish.
        </p>
      </div>
      <ShopsDirectory />
    </div>
  );
}
