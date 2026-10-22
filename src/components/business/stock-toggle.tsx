'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/** One-tap in stock / sold out switch for a menu card. */
export function StockToggle({ productId, inStock: initial }: { productId: string; inStock: boolean }) {
  const router = useRouter();
  const [inStock, setInStock] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function flip() {
    if (busy) return;
    const next = !inStock;
    setBusy(true);
    setInStock(next);
    const result = await api('POST', `/v1/seller/products/${productId}/stock`, { inStock: next });
    setBusy(false);
    if (!result.ok) setInStock(!next);
    else router.refresh();
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={inStock}
      onClick={flip}
      disabled={busy}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full pr-3.5 pl-1 text-xs font-extrabold ring-1 ring-[var(--line)] transition-colors',
        inStock ? 'bg-[var(--leaf-soft)] text-[var(--leaf-ink)]' : 'bg-[var(--tile)] text-[var(--text-muted)]'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid h-7 w-11 items-center rounded-full px-0.5 transition-colors',
          inStock ? 'bg-leaf-600' : 'bg-ink-300'
        )}
      >
        <span
          className={cn(
            'block size-6 rounded-full bg-white shadow transition-transform duration-200',
            inStock && 'translate-x-4'
          )}
        />
      </span>
      {inStock ? 'In stock' : 'Sold out'}
    </button>
  );
}
