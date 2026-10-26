import Link from 'next/link';
import { daysUntil, loadBilling, mandateInPlace } from '@/lib/business/billing';

/**
 * A strip across the console when the owner needs to act: trial ending without automatic
 * payment, an overdue payment, or a hidden shop. Silent otherwise, and silent if the server is down.
 */
export async function BillingBanner() {
  const billing = await loadBilling();
  if (!billing) return null;

  let message: string | null = null;
  let tone: 'warn' | 'danger' = 'warn';

  if (billing.state === 'suspended') {
    message = 'Your shop is hidden from customers because the subscription is unpaid.';
    tone = 'danger';
  } else if (billing.state === 'past_due') {
    message = `Your subscription payment is overdue. Pay within ${daysUntil(billing.access_until)} days to stay visible.`;
    tone = 'danger';
  } else if (billing.state === 'trialing' && !mandateInPlace(billing) && daysUntil(billing.trial_ends_at) <= 7) {
    message = `Your free trial ends in ${daysUntil(billing.trial_ends_at)} days. Set up automatic payment to stay visible.`;
  }
  if (!message) return null;

  return (
    <div
      role="status"
      className={
        tone === 'danger'
          ? 'bg-danger/12 text-[var(--text)] ring-1 ring-danger/35'
          : 'bg-warning/12 text-[var(--text)] ring-1 ring-warning/35'
      }
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium sm:px-6">
        <span>{message}</span>
        <Link href="/business/billing" className="font-bold underline underline-offset-2">
          Open plan
        </Link>
      </div>
    </div>
  );
}
