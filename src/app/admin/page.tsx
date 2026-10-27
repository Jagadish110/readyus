import type { Metadata } from 'next';
import Link from 'next/link';
import { serverApi } from '@/lib/api/server';
import { Card, Eyebrow } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

type Overview = {
  pending_shops: number;
  pending_products: number;
  pending_documents: number;
  shops_live: number;
  shops_suspended: number;
  shops_unpaid: number;
  riders_active: number;
  orders_today: number;
  orders_in_progress: number;
  open_issues: number;
  refunds_waiting: number;
};

export default async function AdminHome() {
  const result = await serverApi<Overview>('/v1/admin/overview');
  const o = result.ok ? result.data : null;

  const tiles: { label: string; value: number | undefined; href: string; attention?: boolean }[] = [
    { label: 'Shops waiting for approval', value: o?.pending_shops, href: '/admin/approvals', attention: true },
    { label: 'Products waiting', value: o?.pending_products, href: '/admin/approvals', attention: true },
    { label: 'Documents to review', value: o?.pending_documents, href: '/admin/approvals', attention: true },
    { label: 'Customer problems open', value: o?.open_issues, href: '/admin/orders', attention: true },
    { label: 'Refunds being processed', value: o?.refunds_waiting, href: '/admin/orders' },
    { label: 'Orders today', value: o?.orders_today, href: '/admin/orders' },
    { label: 'Orders in progress', value: o?.orders_in_progress, href: '/admin/orders' },
    { label: 'Shops live', value: o?.shops_live, href: '/admin/shops' },
    { label: 'Shops with an unpaid plan', value: o?.shops_unpaid, href: '/admin/shops' },
    { label: 'Shops paused by you', value: o?.shops_suspended, href: '/admin/shops' },
    { label: 'Riders', value: o?.riders_active, href: '/admin/riders' }
  ];

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="animate-rise">
        <Eyebrow>Admin</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">Overview</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">What needs a person today, and how the platform is doing.</p>
      </div>

      {!o && (
        <p role="alert" className="rounded-[18px] bg-danger/12 px-4 py-3 text-sm font-semibold ring-1 ring-danger/35">
          {result.ok === false && result.status === 403 ? 'This page is for admins only.' : 'The admin service is not responding.'}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="block rounded-[22px] focus-visible:outline-2">
            <Card className="h-full p-4 transition-shadow hover:shadow-md">
              <p
                className={`font-display text-3xl font-extrabold tracking-[-0.04em] ${
                  tile.attention && (tile.value ?? 0) > 0 ? 'text-brand-600' : ''
                }`}
              >
                {tile.value ?? '–'}
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{tile.label}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
