import type { Metadata } from 'next';
import { Eyebrow } from '@/components/ui/card';
import { AdminsList } from '@/components/admin/admins-list';

export const metadata: Metadata = { title: 'Admins' };

export default function AdminsPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8 sm:py-12">
      <div className="animate-rise">
        <Eyebrow>Admin</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">Admins</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Admins can approve shops, pause accounts and refund orders. Only add people you trust.</p>
      </div>
      <AdminsList />
    </div>
  );
}
