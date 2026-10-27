'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SuspendControl } from './suspend-control';
import { useDirectory } from './use-directory';

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
      aria-label={label}
      className="h-12 w-full rounded-full border border-[var(--line)] bg-[var(--surface)] px-5 text-sm"
    />
  );
}

const PLAN: Record<string, { tone: 'leaf-soft' | 'success' | 'warning' | 'danger'; label: string }> = {
  trialing: { tone: 'leaf-soft', label: 'Free trial' },
  active: { tone: 'success', label: 'Paid' },
  past_due: { tone: 'warning', label: 'Payment overdue' },
  suspended: { tone: 'danger', label: 'Plan unpaid' }
};

type Shop = {
  id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  city: string;
  status: 'pending' | 'approved' | 'rejected';
  suspended_at: string | null;
  suspended_reason: string;
  plan_state: string | null;
  can_trade: boolean;
  fssai_status: string | null;
  orders_30d: number;
};

export function ShopsDirectory() {
  const { term, setTerm, rows, error, reload } = useDirectory<Shop>('/v1/admin/shops', 'shops');
  return (
    <div className="grid gap-4">
      <SearchBox value={term} onChange={setTerm} label="Search by shop, owner or phone" />
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      {rows?.length === 0 && <p className="text-sm text-[var(--text-muted)]">No shops match.</p>}
      {rows?.map((shop) => (
        <Card key={shop.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-extrabold tracking-[-0.02em]">{shop.shop_name}</h2>
              {shop.suspended_at ? (
                <Badge tone="danger">Paused</Badge>
              ) : shop.status !== 'approved' ? (
                <Badge tone="neutral">{shop.status === 'pending' ? 'Waiting for approval' : 'Declined'}</Badge>
              ) : shop.can_trade ? (
                <Badge tone="success">Live</Badge>
              ) : (
                <Badge tone="warning">Hidden</Badge>
              )}
              {shop.plan_state && PLAN[shop.plan_state] && <Badge tone={PLAN[shop.plan_state].tone}>{PLAN[shop.plan_state].label}</Badge>}
              {shop.fssai_status && <Badge tone="neutral">FSSAI {shop.fssai_status}</Badge>}
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              {shop.owner_name} · {shop.phone} · {shop.city || 'City not set'} · {shop.orders_30d} orders in 30 days
            </p>
            {shop.suspended_at && <p className="text-sm">Reason: {shop.suspended_reason}</p>}
          </div>
          {shop.status === 'approved' && (
            <SuspendControl path={`/v1/admin/shops/${shop.id}/suspend`} suspended={Boolean(shop.suspended_at)} onDone={reload} />
          )}
        </Card>
      ))}
    </div>
  );
}

type Rider = {
  id: string;
  full_name: string;
  phone: string;
  vehicle: string;
  status: 'pending' | 'approved' | 'rejected';
  available: boolean;
  shops: number;
  deliveries: number;
};

export function RidersDirectory() {
  const { term, setTerm, rows, error, reload } = useDirectory<Rider>('/v1/admin/riders', 'riders');
  return (
    <div className="grid gap-4">
      <SearchBox value={term} onChange={setTerm} label="Search by name or phone" />
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      {rows?.length === 0 && <p className="text-sm text-[var(--text-muted)]">No riders match.</p>}
      {rows?.map((rider) => (
        <Card key={rider.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="grid gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-extrabold tracking-[-0.02em]">{rider.full_name || 'Unnamed rider'}</h2>
              <Badge tone={rider.status === 'approved' ? 'success' : rider.status === 'pending' ? 'neutral' : 'danger'}>
                {rider.status === 'approved' ? (rider.available ? 'On duty' : 'Off duty') : rider.status === 'pending' ? 'Not on a team yet' : 'Paused'}
              </Badge>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              {rider.phone} · {rider.vehicle || 'Vehicle not set'} · {rider.shops} shops · {rider.deliveries} deliveries
            </p>
          </div>
          {rider.status !== 'pending' && (
            <SuspendControl path={`/v1/admin/riders/${rider.id}/suspend`} suspended={rider.status === 'rejected'} onDone={reload} />
          )}
        </Card>
      ))}
    </div>
  );
}
