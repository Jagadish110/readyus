import type { Metadata } from 'next';
import { serverApi } from '@/lib/api/server';
import { Eyebrow } from '@/components/ui/card';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { ApprovalsBoard, type PendingDocuments, type PendingProduct, type PendingSeller } from '@/components/admin/approvals-board';

export const metadata: Metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  // The backend checks the caller is an admin and reads the pending lists as them.
  const result = await serverApi<{ sellers: PendingSeller[]; products: PendingProduct[]; documents: PendingDocuments[] }>('/v1/admin/approvals');

  const sellers = result.ok ? result.data.sellers : [];
  const products = result.ok ? result.data.products : [];
  const documents = result.ok ? result.data.documents : [];
  const loadError = result.ok
    ? ''
    : result.status === 403
      ? 'This page is for admins only.'
      : 'The approvals service is not responding.';

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8 sm:py-12">
      <div className="animate-rise relative">
        <NotificationCenter className="absolute top-0 right-0" />
        <Eyebrow>Admin</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">
          Approvals
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Shops and products wait here until you approve them. Nothing is visible to customers before then.
        </p>
      </div>

      {loadError && (
        <p
          role="alert"
          className="rounded-[18px] bg-danger/12 px-4 py-3 text-sm font-semibold text-[var(--text)] ring-1 ring-danger/35"
        >
          Could not load applications: {loadError}
        </p>
      )}

      <ApprovalsBoard sellers={sellers} products={products} documents={documents} />
    </div>
  );
}
