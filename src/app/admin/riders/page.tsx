import type { Metadata } from 'next';
import { Eyebrow } from '@/components/ui/card';
import { RidersDirectory } from '@/components/admin/directories';

export const metadata: Metadata = { title: 'Riders' };

export default function RidersPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8 sm:py-12">
      <div className="animate-rise">
        <Eyebrow>Admin</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">Riders</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A paused rider cannot be assigned deliveries. A rider on a delivery cannot be paused until it is done.
        </p>
      </div>
      <RidersDirectory />
    </div>
  );
}
