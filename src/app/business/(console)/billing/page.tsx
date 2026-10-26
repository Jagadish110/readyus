import type { Metadata } from 'next';
import { requireShop } from '@/lib/business/shop';
import {
  daysUntil,
  formatDay,
  loadBilling,
  mandateInPlace,
  type Billing,
  type BillingState
} from '@/lib/business/billing';
import { SubscribeButton } from '@/components/business/subscribe-button';
import { AutoRefresh } from '@/components/orders/auto-refresh';
import { Badge } from '@/components/ui/badge';
import { Card, Eyebrow } from '@/components/ui/card';
import { formatPaise } from '@/lib/utils';

export const metadata: Metadata = { title: 'Plan' };
export const dynamic = 'force-dynamic';

const BADGE: Record<BillingState, { tone: 'success' | 'warning' | 'danger' | 'leaf-soft'; label: string }> = {
  trialing: { tone: 'leaf-soft', label: 'Free trial' },
  active: { tone: 'success', label: 'Active' },
  past_due: { tone: 'warning', label: 'Payment overdue' },
  suspended: { tone: 'danger', label: 'Shop hidden' }
};

export default async function BillingPage() {
  const { shop } = await requireShop();
  const billing = shop.status === 'approved' ? await loadBilling() : null;

  return (
    <div className="animate-rise grid gap-5">
      <div>
        <Eyebrow>{shop.shop_name}</Eyebrow>
        <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
          Your plan
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          One flat monthly fee. No commission on orders and no fee per order.
        </p>
      </div>

      {!billing ? (
        <Card className="p-5 sm:p-6">
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            {shop.status === 'approved'
              ? 'We could not load your plan right now. Please try again in a moment.'
              : 'Your free trial starts the day your shop is approved.'}
          </p>
        </Card>
      ) : (
        <PlanCard billing={billing} />
      )}
    </div>
  );
}

function PlanCard({ billing }: { billing: Billing }) {
  const badge = BADGE[billing.state];
  const waiting = (billing.mandate_status ?? '').toUpperCase() === 'BANK_APPROVAL_PENDING';
  const set = mandateInPlace(billing);
  const price = `${formatPaise(billing.price_paise)} / month + GST`;
  const through = formatDay(billing.paid_through ?? billing.access_until);

  const headline: Record<BillingState, string> = {
    trialing: `${daysUntil(billing.trial_ends_at)} days of free trial left`,
    active: billing.cancelled ? `Your plan ends on ${through}` : `Paid until ${through}`,
    past_due: `Pay within ${daysUntil(billing.access_until)} days to stay visible`,
    suspended: 'Customers cannot find your shop right now'
  };

  const body: Record<BillingState, string> = {
    trialing: set
      ? `Automatic payment is set up. Your first charge of ${price} is on ${formatDay(billing.trial_ends_at)}.`
      : `Set up automatic payment now and you will not be charged until ${formatDay(billing.trial_ends_at)}.`,
    active: billing.cancelled
      ? 'Automatic payment is off. Set it up again before that date to stay visible.'
      : 'Your shop is visible and taking orders. The next payment is taken automatically.',
    past_due:
      'Your last payment did not go through. Your shop is still visible for now, but it will be hidden when the days run out.',
    suspended:
      'Your subscription is unpaid, so your shop is hidden and cannot take new orders. Orders you already have can still be completed. Set up payment and your shop returns at once.'
  };

  const needsSetup = !waiting && (billing.state === 'active' ? billing.cancelled : !set);

  return (
    <Card className="grid gap-4 p-5 sm:p-6">
      {/* While the bank confirms, look again every few seconds so the result shows without a reload. */}
      {waiting && <AutoRefresh everyMs={5_000} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">{headline[billing.state]}</h2>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <p className="text-sm leading-relaxed text-[var(--text-muted)]">{body[billing.state]}</p>

      <dl className="grid gap-1 rounded-[18px] bg-[var(--tile)] p-3.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text-muted)]">Price</dt>
          <dd className="font-bold">{price}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--text-muted)]">Automatic payment</dt>
          <dd className="font-bold">
            {waiting ? 'Waiting for your bank' : set ? 'On' : billing.cancelled ? 'Cancelled' : 'Not set up'}
          </dd>
        </div>
      </dl>

      {waiting && (
        <p className="text-sm text-[var(--text-muted)]">
          Your bank is confirming the approval. This page updates by itself, so you can leave it open.
        </p>
      )}

      {needsSetup && (
        <SubscribeButton
          label={billing.state === 'suspended' ? 'Pay and bring my shop back' : 'Set up automatic payment'}
        />
      )}
      {set && !waiting && (
        <div className="border-t border-[var(--line)] pt-3">
          <SubscribeButton cancel label="Stop automatic payment" />
        </div>
      )}
    </Card>
  );
}
