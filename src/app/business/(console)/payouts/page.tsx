import type { Metadata } from 'next';
import { requireShop } from '@/lib/business/shop';
import { type PayoutAccount, type PayoutStatus } from '@/lib/razorpay/api';
import { serverApi } from '@/lib/api/server';
import { PayoutForm } from '@/components/business/payout-form';
import { Badge } from '@/components/ui/badge';
import { Card, Eyebrow } from '@/components/ui/card';
import { formatPaise } from '@/lib/utils';

export const metadata: Metadata = { title: 'Payouts' };
export const dynamic = 'force-dynamic';

type OrderLine = {
  id: string;
  order_code: string;
  status: string;
  verified_prepaid_paise: number;
  refunded_paise: number;
  created_at: string;
};

/** This shop's payout status from the backend. If it is down the page still renders, without it. */
async function loadPayoutAccount(): Promise<PayoutAccount | null> {
  const result = await serverApi<{ account: PayoutAccount | null }>('/v1/seller/payout');
  return result.ok ? result.data.account : null;
}

const ENDED = ['rejected', 'cancelled_by_customer', 'cancelled', 'timed_out'];

const ACCOUNT_BADGE: Record<PayoutStatus, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  activated: { tone: 'success', label: 'Ready for payouts' },
  under_review: { tone: 'warning', label: 'Being verified' },
  created: { tone: 'warning', label: 'Being set up' },
  needs_clarification: { tone: 'warning', label: 'More details needed' },
  rejected: { tone: 'danger', label: 'Not approved' }
};

const ACCOUNT_BODY: Record<PayoutStatus, string> = {
  activated: 'Customers can pay online. Their money goes straight to your bank account.',
  under_review: 'Our payment partner is checking your details. This usually takes a day or two. Until then customers pay you by UPI.',
  created: 'Your account is being set up. Save your bank details to finish.',
  needs_clarification: 'Your payment partner needs a few more details before they can send you money.',
  rejected: 'Your payment partner could not approve these details. Check them and try again.'
};

export default async function PayoutsPage() {
  const { shop } = await requireShop();

  const ordersResult = await serverApi<{ orders: OrderLine[] }>('/v1/seller/payout-orders');
  const orders = ordersResult.ok ? ordersResult.data.orders : [];

  const account = shop.status === 'approved' ? await loadPayoutAccount() : null;

  const delivered = orders.filter((order) => order.status === 'delivered').length;
  const paidOnline = orders.filter((order) => order.verified_prepaid_paise > 0);
  // Money that stayed with the shop: paid online, not refunded, order not cancelled.
  const received = paidOnline
    .filter((order) => !ENDED.includes(order.status))
    .reduce((sum, order) => sum + order.verified_prepaid_paise - order.refunded_paise, 0);
  const refunded = paidOnline.reduce((sum, order) => sum + order.refunded_paise, 0);

  const stats = [
    { label: 'Total orders', value: String(orders.length) },
    { label: 'Delivered', value: String(delivered) },
    { label: 'Paid online', value: formatPaise(received) }
  ];

  return (
    <div className="animate-rise grid gap-5">
      <div>
        <Eyebrow>{shop.shop_name}</Eyebrow>
        <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
          Payouts
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Online payments go directly from the customer to your bank account. ReadyUs does not hold your money.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-4 text-center">
            <p className="font-display text-xl font-extrabold tracking-[-0.04em] sm:text-2xl">{stat.value}</p>
            <p className="mt-1 text-xs leading-tight font-semibold text-[var(--text-muted)]">{stat.label}</p>
          </Card>
        ))}
      </div>

      <Card className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Bank account</h2>
          {account && (
            <Badge tone={ACCOUNT_BADGE[account.status].tone}>{ACCOUNT_BADGE[account.status].label}</Badge>
          )}
        </div>

        {shop.status !== 'approved' ? (
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            You can add bank details once your shop is approved.
          </p>
        ) : (
          <>
            {account && (
              <>
                <p className="text-sm leading-relaxed text-[var(--text-muted)]">{ACCOUNT_BODY[account.status]}</p>
                {account.bank_last4 && (
                  <dl className="grid gap-1 rounded-[18px] bg-[var(--tile)] p-3.5 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">Account holder</dt>
                      <dd className="font-bold">{account.beneficiary_name}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">Account</dt>
                      <dd className="font-bold tabular-nums">&bull;&bull;&bull;&bull; {account.bank_last4}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--text-muted)]">IFSC</dt>
                      <dd className="font-bold">{account.bank_ifsc}</dd>
                    </div>
                  </dl>
                )}
                {account.status_detail && (
                  <p className="rounded-[16px] bg-warning/12 px-4 py-3 text-sm font-medium ring-1 ring-warning/35">
                    Still needed: {account.status_detail}
                  </p>
                )}
              </>
            )}

            {account?.bank_last4 ? (
              <details className="border-t border-[var(--line)] pt-3">
                <summary className="cursor-pointer text-sm font-bold text-[var(--leaf-ink)]">
                  Change bank details
                </summary>
                <div className="mt-4">
                  <PayoutForm hasAccount defaultName={shop.shop_name} />
                </div>
              </details>
            ) : (
              <PayoutForm hasAccount={Boolean(account)} defaultName="" />
            )}
          </>
        )}
      </Card>

      <Card className="grid gap-3 p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Online payments</h2>
          {refunded > 0 && (
            <span className="text-xs font-semibold text-[var(--text-muted)]">{formatPaise(refunded)} refunded</span>
          )}
        </div>
        {paidOnline.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No online payments yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {paidOnline.slice(0, 10).map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block font-bold">{order.order_code}</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {order.refunded_paise > 0 ? ' · refunded' : ''}
                  </span>
                </span>
                <span className="font-bold tabular-nums">{formatPaise(order.verified_prepaid_paise)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
