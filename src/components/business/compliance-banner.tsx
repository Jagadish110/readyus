import Link from 'next/link';
import { fssaiAttention, loadDocuments } from '@/lib/business/documents';

/** A strip across the console when the FSSAI licence needs the owner: missing, rejected, expiring or expired. */
export async function ComplianceBanner() {
  const info = await loadDocuments();
  const attention = info ? fssaiAttention(info) : null;
  if (!attention) return null;

  return (
    <div
      role="status"
      className={attention.tone === 'danger' ? 'bg-danger/12 ring-1 ring-danger/35' : 'bg-warning/12 ring-1 ring-warning/35'}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium sm:px-6">
        <span>{attention.message}</span>
        <Link href="/business/documents" className="font-bold underline underline-offset-2">
          Open documents
        </Link>
      </div>
    </div>
  );
}
