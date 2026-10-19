'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type PendingSeller = {
  id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  category: string;
  listing_mode: string;
  address: string;
  city: string;
  pincode: string;
  created_at: string;
  pin: { lat: number; lng: number } | null;
};

export type PendingProduct = {
  id: string;
  name: string;
  price: number | string;
  unit: string;
  category_key: string;
  listing_mode: string;
  created_at: string;
  sellers: { shop_name: string } | null;
};

// The checked-in Database type does not describe functions to supabase-js yet,
// so the review call is typed here.
type Client = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ error: { message: string } | null }>;
};

type Tab = 'shops' | 'products';

const ERRORS: Record<string, string> = {
  ADMIN_ONLY: 'Only an admin can review applications.',
  SELLER_NOT_FOUND: 'That shop no longer exists.',
  PRODUCT_NOT_FOUND: 'That product no longer exists.'
};

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function ApprovalsBoard({
  sellers: initialSellers,
  products: initialProducts
}: {
  sellers: PendingSeller[];
  products: PendingProduct[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>('shops');
  const [sellers, setSellers] = useState(initialSellers);
  const [products, setProducts] = useState(initialProducts);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [, startTransition] = useTransition();

  // After router.refresh() the server sends fresh lists; adopt them.
  useEffect(() => setSellers(initialSellers), [initialSellers]);
  useEffect(() => setProducts(initialProducts), [initialProducts]);

  async function review(kind: Tab, id: string, approve: boolean) {
    setBusy(id);
    setError('');
    const client = supabase as unknown as Client;
    const p_note = approve ? '' : note.trim();
    const { error: failure } =
      kind === 'shops'
        ? await client.rpc('review_seller', { p_seller: id, p_approve: approve, p_note })
        : await client.rpc('review_product', { p_product: id, p_approve: approve, p_note });
    setBusy(null);
    if (failure) {
      const code = Object.keys(ERRORS).find((key) => failure.message.includes(key));
      setError(code ? ERRORS[code]! : failure.message);
      return;
    }
    if (kind === 'shops') setSellers((rows) => rows.filter((row) => row.id !== id));
    else setProducts((rows) => rows.filter((row) => row.id !== id));
    setDeclining(null);
    setNote('');
    startTransition(() => router.refresh());
  }

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'shops', label: 'Shops', count: sellers.length },
    { key: 'products', label: 'Products', count: products.length }
  ];

  function declineBox(id: string, kind: Tab) {
    return (
      <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4">
        <label className="grid gap-1.5 text-sm font-semibold">
          Note for the owner (optional)
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={300}
            className="w-full rounded-[18px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-base font-normal outline-none focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20"
          />
        </label>
        <div className="flex gap-2">
          <Button variant="danger" size="sm" loading={busy === id} onClick={() => review(kind, id, false)}>
            Confirm decline
          </Button>
          <Button
            variant="leaf-outline"
            size="sm"
            onClick={() => {
              setDeclining(null);
              setNote('');
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  function actions(id: string, kind: Tab) {
    return (
      <div className="mt-4 flex gap-2">
        <Button
          variant="leaf"
          size="sm"
          loading={busy === id && declining !== id}
          disabled={busy === id}
          onClick={() => review(kind, id, true)}
        >
          Approve
        </Button>
        <Button
          variant="leaf-outline"
          size="sm"
          disabled={busy === id}
          onClick={() => {
            setDeclining(declining === id ? null : id);
            setNote('');
          }}
        >
          Decline
        </Button>
      </div>
    );
  }

  const list = tab === 'shops' ? sellers : products;

  return (
    <div className="grid gap-4">
      <div role="tablist" className="animate-rise flex gap-2 [animation-delay:60ms]">
        {tabs.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => {
              setTab(item.key);
              setDeclining(null);
              setError('');
            }}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-bold ring-1 transition-colors',
              tab === item.key
                ? 'bg-leaf-600 text-white ring-leaf-600'
                : 'bg-[var(--surface)] text-[var(--leaf-ink)] ring-[var(--line)] hover:bg-[var(--leaf-soft)]'
            )}
          >
            {item.label}
            <span className={cn('text-xs', tab === item.key ? 'text-white/80' : 'text-[var(--text-muted)]')}>
              {item.count}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-[18px] bg-danger/12 px-4 py-3 text-sm font-semibold text-[var(--text)] ring-1 ring-danger/35"
        >
          {error}
        </p>
      )}

      {list.length === 0 && (
        <Card className="animate-rise p-8 text-center [animation-delay:100ms]">
          <p className="font-display text-lg font-extrabold tracking-[-0.03em]">Nothing is waiting</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            New {tab === 'shops' ? 'shop applications' : 'products'} will show up here.
          </p>
        </Card>
      )}

      {tab === 'shops' &&
        sellers.map((shop, index) => (
          <Card
            key={shop.id}
            className="animate-rise p-5"
            style={{ animationDelay: 100 + Math.min(index, 5) * 40 + 'ms' }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-extrabold tracking-[-0.03em] break-words">{shop.shop_name}</h2>
                <p className="text-sm text-[var(--text-muted)]">Applied {when(shop.created_at)}</p>
              </div>
              <Badge tone="leaf-soft">{shop.listing_mode === 'food' ? 'Food' : 'Items'}</Badge>
            </div>

            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Field label="Owner" value={shop.owner_name} />
              <Field label="Mobile" value={shop.phone} />
              <Field label="Category" value={shop.category} />
              <Field label="City / pincode" value={[shop.city, shop.pincode].filter(Boolean).join(' · ')} />
              <div className="sm:col-span-2">
                <Field label="Address" value={shop.address} />
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-bold tracking-[0.14em] text-[var(--text-muted)] uppercase">Pinned location</dt>
                <dd className="mt-1 font-semibold">
                  {shop.pin ? (
                    <>
                      {shop.pin.lat.toFixed(5)}, {shop.pin.lng.toFixed(5)}{' '}
                      <a
                        href={'https://www.google.com/maps?q=' + shop.pin.lat + ',' + shop.pin.lng}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 text-[var(--leaf-ink)] underline-offset-2 hover:underline"
                      >
                        Open in Maps
                      </a>
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">No pin saved</span>
                  )}
                </dd>
              </div>
            </dl>

            {actions(shop.id, 'shops')}
            {declining === shop.id && declineBox(shop.id, 'shops')}
          </Card>
        ))}

      {tab === 'products' &&
        products.map((item, index) => (
          <Card
            key={item.id}
            className="animate-rise p-5"
            style={{ animationDelay: 100 + Math.min(index, 5) * 40 + 'ms' }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-extrabold tracking-[-0.03em] break-words">{item.name}</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  {item.sellers?.shop_name ?? 'Unknown shop'} · added {when(item.created_at)}
                </p>
              </div>
              <span className="font-display text-lg font-extrabold text-brand-600">
                ₹{Number(item.price).toLocaleString('en-IN')}
                {item.unit && <span className="text-sm font-semibold text-[var(--text-muted)]"> / {item.unit}</span>}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="leaf-soft">{item.listing_mode === 'food' ? 'Food' : 'Items'}</Badge>
              {item.category_key && <Badge>{item.category_key}</Badge>}
            </div>

            {actions(item.id, 'products')}
            {declining === item.id && declineBox(item.id, 'products')}
          </Card>
        ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold tracking-[0.14em] text-[var(--text-muted)] uppercase">{label}</dt>
      <dd className="mt-1 font-semibold break-words">{value || <span className="text-[var(--text-muted)]">Not added</span>}</dd>
    </div>
  );
}
