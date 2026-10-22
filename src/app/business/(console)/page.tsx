import type { Metadata } from 'next';
import { requireShop } from '@/lib/business/shop';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/business/db';
import { serverApi } from '@/lib/api/server';
import { Badge } from '@/components/ui/badge';
import { Card, Eyebrow } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { ShopControls } from '@/components/business/shop-controls';

export const metadata: Metadata = { title: 'Seller dashboard' };
export const dynamic = 'force-dynamic';

const STATUS_BODY = {
  pending: 'We are reviewing your shop. Customers cannot see it until it is approved.',
  approved: 'Your shop is approved. Customers inside your delivery radius can find you while you are open.',
  rejected: 'This application was declined. Read the note below and apply again with the details fixed.'
} as const;

export default async function DashboardPage() {
  const { shop } = await requireShop();

  const result = await serverApi<{ products: Array<{ approval_status: string; available: boolean }> }>('/v1/seller/products');
  const products = result.ok ? result.data.products : [];
  const live = products.filter((p) => p.approval_status === 'approved' && p.available).length;
  const waiting = products.filter((p) => p.approval_status === 'pending').length;

  const online = await serverApi<{ ready: string[] }>(`/v1/shops/online?ids=${shop.id}`);
  // If the backend is unreachable, do not nag the owner to add details they may already have.
  const acceptsOnline = !online.ok || online.data.ready.includes(shop.id);

  const stats = [
    { label: 'Products', value: products.length },
    { label: 'Live to customers', value: live },
    { label: 'Awaiting review', value: waiting }
  ];

  return (
    <div className="animate-rise grid gap-5">
      <div>
        <Eyebrow>Seller dashboard</Eyebrow>
        <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
          {shop.shop_name}
        </h1>
      </div>

      <Card className="grid gap-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone={STATUS_TONE[shop.status]}>{STATUS_LABEL[shop.status]}</Badge>
          {shop.status === 'approved' && (
            <Badge tone={shop.business_open ? 'leaf-soft' : 'neutral'}>
              {shop.business_open ? 'Open for orders' : 'Closed'}
            </Badge>
          )}
        </div>
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">{STATUS_BODY[shop.status]}</p>
        {shop.review_note && (
          <p className="rounded-[18px] bg-[var(--tile)] p-3.5 text-sm leading-relaxed">
            <span className="block text-xs font-bold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">
              Note from the team
            </span>
            {shop.review_note}
          </p>
        )}
        {shop.status === 'rejected' && (
          <ButtonLink href="/business/apply" variant="leaf" size="sm" className="justify-self-start">
            Apply again
          </ButtonLink>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-4 text-center">
            <p className="font-display text-2xl font-extrabold tracking-[-0.04em]">{stat.value}</p>
            <p className="mt-1 text-xs leading-tight font-semibold text-[var(--text-muted)]">{stat.label}</p>
          </Card>
        ))}
      </div>

      {shop.status === 'approved' && !acceptsOnline && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5 ring-1 ring-warning/35 sm:p-6">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">
              Add your bank details to get paid online
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              Without them, customers can only pay you by UPI or cash. With them, online payments go straight
              to your bank account.
            </p>
          </div>
          <ButtonLink href="/business/payouts" variant="leaf" size="sm">
            Add bank details
          </ButtonLink>
        </Card>
      )}

      <ShopControls shop={shop} />

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
        <div>
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Your menu</h2>
          <p className="text-sm text-[var(--text-muted)]">New items go live for nearby customers as soon as you save them.</p>
        </div>
        <ButtonLink href="/business/products" variant="leaf-outline" size="sm">
          Manage products
        </ButtonLink>
      </Card>
    </div>
  );
}
