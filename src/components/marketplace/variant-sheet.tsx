'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NearbyProduct, ProductVariant } from '@/lib/database.types';
import { VegMark } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExtrasPicker, Stepper, useProductInCart } from './add-to-cart-panel';
import { MinusIcon, PlusIcon } from '@/components/shell/icons';
import { choosePrompt, comboSummary } from '@/lib/menu';
import { cn, formatRupees } from '@/lib/utils';

/**
 * Picking a size from a menu: a sheet that rises from the bottom of a phone (a centred panel on a
 * desktop), one line per size with its own Add or − count +. Rendered on <body>, so a card's hover
 * transform can never trap the fixed overlay inside the card.
 */
export function VariantSheet({ product, onClose }: { product: NearbyProduct; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll under a thumb that is choosing a size.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  useEffect(() => {
    if (mounted) panel.current?.focus();
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button type="button" aria-label="Close" onClick={onClose} className="animate-fade absolute inset-0 bg-ink-900/45" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${choosePrompt(product.variant_name)} for ${product.name}`}
        tabIndex={-1}
        className="animate-sheet relative grid max-h-[92dvh] w-full max-w-md gap-4 overflow-y-auto overscroll-contain rounded-t-[28px] bg-[var(--surface)] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl outline-none sm:animate-pop sm:rounded-[28px]"
      >
        <span aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-[var(--line)] sm:hidden" />
        <div className="flex items-start gap-2">
          <VegMark type={product.veg_type} />
          <div className="min-w-0">
            <h2 className="font-display text-lg leading-tight font-extrabold tracking-[-0.025em]">{product.name}</h2>
            <p className="text-sm text-[var(--text-muted)]">
              {product.extras?.length ? 'Customise it' : choosePrompt(product.variant_name)}
            </p>
            {/* A combo with choices ("which pizza") still says what comes with it. */}
            {comboSummary(product.combo_items) && (
              <p className="mt-0.5 text-xs font-semibold">{comboSummary(product.combo_items)}</p>
            )}
          </div>
        </div>

        {product.extras?.length ? (
          <Customise product={product} onDone={onClose} />
        ) : (
          <>
            <ul className="grid gap-2">
              {product.variants.map((variant) => (
                <SizeRow key={variant.id} product={product} variant={variant} />
              ))}
            </ul>

            <Button variant="leaf" size="lg" fullWidth onClick={onClose}>
              Done
            </Button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/** A dish with extras: pick the size (if it has sizes), the extras, how many, then add that one line. */
function Customise({ product, onDone }: { product: NearbyProduct; onDone: () => void }) {
  const sizes = product.variants ?? [];
  const [sizeId, setSizeId] = useState(sizes[0]?.id);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [count, setCount] = useState(Math.max(1, product.min_order_qty || 1));
  const size = sizes.find((entry) => entry.id === sizeId);
  const chosen = (product.extras ?? []).filter((extra) => extraIds.includes(extra.id));
  const { unitPrice, addMany } = useProductInCart(product, size, chosen);
  const closed = product.business_open === false;
  const most = Math.max(1, Math.min(99, product.stock));

  return (
    <>
      {sizes.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-bold">{choosePrompt(product.variant_name)}</p>
          <div role="radiogroup" aria-label={product.variant_name || 'Size'} className="flex flex-wrap gap-2">
            {sizes.map((entry) => {
              const active = entry.id === sizeId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSizeId(entry.id)}
                  className={cn(
                    'flex min-h-12 flex-col items-start justify-center rounded-[16px] border-[1.5px] px-4 py-1.5 text-left transition-colors active:scale-[0.97]',
                    active ? 'border-brand-500 bg-brand-500/10' : 'border-[var(--line)] bg-[var(--surface)] hover:border-brand-300'
                  )}
                >
                  <span className="text-sm font-extrabold">{entry.label}</span>
                  <span className="text-xs font-bold text-[var(--text-muted)]">{formatRupees(Number(entry.price))}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <ExtrasPicker
        extras={product.extras ?? []}
        size={size?.label}
        selected={extraIds}
        onToggle={(id) => setExtraIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))}
      />

      <div className="flex items-center gap-3">
        <div className="flex h-14 shrink-0 items-center rounded-full ring-1 ring-[var(--line)]">
          <button
            type="button"
            aria-label="One fewer"
            disabled={count <= 1}
            onClick={() => setCount(count - 1)}
            className="grid size-12 place-items-center rounded-full disabled:opacity-40"
          >
            <MinusIcon className="size-4" />
          </button>
          <span className="min-w-6 text-center font-extrabold tabular-nums" aria-live="polite">
            {count}
          </span>
          <button
            type="button"
            aria-label="One more"
            disabled={count >= most}
            onClick={() => setCount(count + 1)}
            className="grid size-12 place-items-center rounded-full disabled:opacity-40"
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
        <Button
          size="lg"
          fullWidth
          disabled={closed || product.stock <= 0}
          onClick={() => {
            addMany(count);
            onDone();
          }}
        >
          {closed ? 'Shop closed' : `Add · ${formatRupees(unitPrice * count)}`}
        </Button>
      </div>
    </>
  );
}

function SizeRow({ product, variant }: { product: NearbyProduct; variant: ProductVariant }) {
  const { quantity, addFirst, swapped } = useProductInCart(product, variant);
  const closed = product.business_open === false;
  return (
    <li className="flex min-h-16 items-center justify-between gap-3 rounded-[18px] bg-[var(--tile)] py-2 pr-2 pl-4">
      <span className="min-w-0">
        <span className="block font-bold">{variant.label}</span>
        <span className="block text-sm font-extrabold text-brand-600">{formatRupees(Number(variant.price))}</span>
      </span>
      {quantity === 0 ? (
        <button
          type="button"
          disabled={closed || product.stock <= 0}
          onClick={addFirst}
          className={cn(
            'h-11 min-w-[5.5rem] shrink-0 rounded-full bg-brand-500 px-5 text-sm font-extrabold tracking-wide text-white shadow-[0_8px_20px_rgb(255_77_28/0.3)] transition-transform active:scale-95 disabled:bg-ink-400 disabled:shadow-none',
            swapped.count > 0 && 'animate-pop'
          )}
        >
          {closed ? 'CLOSED' : 'ADD'}
        </button>
      ) : (
        <Stepper product={product} variant={variant} size="sm" pop={swapped.count > 0} />
      )}
    </li>
  );
}
