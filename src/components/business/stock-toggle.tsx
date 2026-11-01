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
        // A phone stacks the label under the switch: narrow enough to leave the dish name room, tall enough to hit.
        'inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-[16px] px-2 py-1 text-[0.68rem] font-extrabold ring-1 ring-[var(--line)] transition-colors',
        'sm:min-h-0 sm:h-9 sm:flex-row sm:gap-2 sm:rounded-full sm:py-0 sm:pr-3.5 sm:pl-1 sm:text-xs',
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
