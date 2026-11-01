'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { NearbyProduct, ProductVariant, ShopExtra } from '@/lib/database.types';
import { lineKey, useCart } from '@/lib/state/cart';
import { Button, ButtonLink } from '@/components/ui/button';
import { MinusIcon, PlusIcon } from '@/components/shell/icons';
import { useChangePulse } from '@/components/motion/use-change-pulse';
import { RollingNumber } from '@/components/motion/rolling-number';
import { cn, formatRupees } from '@/lib/utils';
import { choosePrompt, extraPrice } from '@/lib/menu';

/**
 * The cart line for one product, one size of it, or one size with a set of extras. Each is its own line,
 * priced from the size plus each extra's price for that size (place_order prices it the same way).
 * Pass `extras` (even empty) for a dish that offers extras, so the line is exactly that choice.
 */
export function useProductInCart(product: NearbyProduct, variant?: ProductVariant, extras?: ShopExtra[]) {
  const { add, setQuantity, quantityOf, subtotal, ready } = useCart();
  const chosen = (extras ?? []).map((extra) => ({ id: extra.id, label: extra.label, price: extraPrice(extra, variant?.label) }));
  const quantity = extras
    ? quantityOf(product.id, variant?.id, chosen.map((extra) => extra.id))
    : quantityOf(product.id, variant ? variant.id : product.variants?.length ? '' : undefined);
  const key = lineKey({ productId: product.id, variantId: variant?.id, extras: chosen });
  const unitPrice = (variant ? Number(variant.price) : product.price) + chosen.reduce((total, extra) => total + extra.price, 0);
  // `swapped` pulses only on a real Add or remove, not when the saved cart loads in.
  const swapped = useChangePulse(quantity > 0 ? 1 : 0, ready);
  const line = {
    productId: product.id,
    sellerId: product.seller_id,
    sellerName: product.seller_name,
    name: product.name,
    unit: variant ? variant.label : product.unit,
    price: unitPrice,
    mrp: variant ? (variant.mrp ?? null) : product.mrp,
    vegType: product.veg_type,
    image: product.images?.[0] ?? null,
    ...(variant ? { variantId: variant.id, variantLabel: variant.label } : {}),
    ...(chosen.length ? { extras: chosen } : {})
  };
  return {
    quantity,
    subtotal,
    swapped,
    unitPrice,
    soldOut: product.stock <= 0,
    addFirst: () => add(line, product.min_order_qty),
    addMany: (count: number) => add(line, count),
    less: () => setQuantity(key, quantity - 1),
    more: () => setQuantity(key, quantity + 1),
    atMax: quantity >= product.stock
  };
}

/** `pop` is set by a parent that saw the dish go into the cart just now, not on a page that loads with it there. */
export function Stepper({
  product,
  variant,
  extras,
  size,
  pop
}: {
  product: NearbyProduct;
  variant?: ProductVariant;
  extras?: ShopExtra[];
  size: 'sm' | 'md' | 'lg';
  pop: boolean;
}) {
  const { quantity, less, more, atMax } = useProductInCart(product, variant, extras);
  const box = size === 'lg' ? 'h-14' : size === 'md' ? 'h-12' : 'h-11';
  const target = size === 'sm' ? 'size-11' : 'size-12';
  const label = variant ? `${product.name}, ${variant.label}` : product.name;
  return (
    <div
      className={cn(
        'flex shrink-0 items-center rounded-full bg-brand-500 text-white shadow-[0_8px_26px_rgb(255_77_28/0.32)]',
        box,
        pop && 'animate-pop'
      )}
    >
      <button
        type="button"
        aria-label={`Remove one ${label}`}
        onClick={less}
        className={cn('grid place-items-center rounded-full transition-transform hover:bg-white/20 active:scale-90', target)}
      >
        <MinusIcon className="size-4" />
      </button>
      <span
        className={cn('min-w-7 overflow-hidden text-center font-extrabold tabular-nums', size === 'sm' ? 'text-sm' : 'font-display text-lg')}
        aria-live="polite"
      >
        <RollingNumber value={quantity} />
      </span>
      <button
        type="button"
        aria-label={`Add one ${label}`}
        disabled={atMax}
        onClick={more}
        className={cn('grid place-items-center rounded-full transition-transform hover:bg-white/20 active:scale-90 disabled:opacity-40', target)}
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}

/** The add-to-cart controls in the page itself, for tablets and desktops. Phones use ProductActionBar. */
export function AddToCartPanel({ product, variant, extras }: { product: NearbyProduct; variant?: ProductVariant; extras?: ShopExtra[] }) {
  const { quantity, soldOut, addFirst, swapped } = useProductInCart(product, variant, extras);

  if (soldOut) {
    return (
      <p className="rounded-lg border-l-[3px] border-danger bg-danger/12 px-3.5 py-3 text-sm font-semibold text-[var(--text)]">
        Sold out right now.
      </p>
    );
  }

  if (quantity === 0) {
    return (
      <Button size="lg" fullWidth onClick={addFirst} className="hidden md:inline-flex">
        Add {variant ? variant.label : ''} to cart
      </Button>
    );
  }

  return (
    <div className="hidden flex-wrap items-center gap-3 md:flex">
      <Stepper product={product} variant={variant} extras={extras} size="lg" pop={swapped.count > 0} />
      <ButtonLink href="/cart" transitionTypes={['nav-forward']} size="lg" variant="outline" className="flex-1">
        Go to cart
      </ButtonLink>
    </div>
  );
}

/**
 * On a phone the dish photo fills the screen, so the way to add it lives in a bar pinned above the
 * bottom navigation: price and Add first, then the stepper and the cart total once it is in.
 */
export function ProductActionBar({ product, variant, extras }: { product: NearbyProduct; variant?: ProductVariant; extras?: ShopExtra[] }) {
  const { quantity, subtotal, soldOut, addFirst, swapped, unitPrice } = useProductInCart(product, variant, extras);
  const closed = product.business_open === false;
  if (soldOut) return null;

  return (
    <div
      // Named so it holds still while pages slide (see the page transition rules in globals.css).
      style={{ viewTransitionName: 'action-bar' }}
      className="fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 px-4 md:hidden"
    >
      <div className="animate-rise mx-auto flex max-w-lg items-center gap-3 rounded-[26px] bg-[var(--surface)] p-2 pl-4 shadow-[0_14px_40px_rgb(28_22_20/0.22)] ring-1 ring-[var(--line)]">
        {quantity === 0 ? (
          <>
            <span className="grid min-w-0 leading-tight">
              <span className="font-display text-xl font-extrabold tracking-[-0.03em]">{formatRupees(unitPrice)}</span>
              <span className="truncate text-xs text-[var(--text-muted)]">{variant ? variant.label : product.unit}</span>
            </span>
            <button
              type="button"
              onClick={addFirst}
              disabled={closed}
              className={cn(
                'ml-auto h-12 flex-1 rounded-full bg-brand-500 px-6 text-base font-extrabold text-white shadow-ember transition-transform active:scale-[0.97] disabled:bg-ink-400 disabled:shadow-none',
                swapped.count > 0 && 'animate-pop'
              )}
            >
              {closed ? 'Shop closed' : 'Add to cart'}
            </button>
          </>
        ) : (
          <>
            <Stepper product={product} variant={variant} extras={extras} size="md" pop={swapped.count > 0} />
            <Link
              href="/cart"
              transitionTypes={['nav-forward']}
              className={cn(
                'flex h-12 flex-1 items-center justify-between gap-2 overflow-hidden rounded-full bg-leaf-600 px-4 text-white transition-transform active:scale-[0.98]',
                swapped.count > 0 && 'animate-pop'
              )}
            >
              <RollingNumber value={subtotal} className="text-sm font-bold tabular-nums">
                {formatRupees(subtotal)}
              </RollingNumber>
              <span className="text-sm font-extrabold">View cart →</span>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The buying part of a dish page: the size picker when the dish comes in sizes, then the add controls
 * (in the page on larger screens, pinned at the bottom on a phone) for the chosen size.
 */
export function ProductBuy({ product }: { product: NearbyProduct }) {
  const sizes = product.variants ?? [];
  const offered = product.extras ?? [];
  const [chosenId, setChosenId] = useState(sizes[0]?.id);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const { lines } = useCart();
  const chosen = sizes.find((size) => size.id === chosenId);
  // Only a dish that offers extras passes them, so every other dish keeps its single cart line.
  const chosenExtras = offered.length ? offered.filter((extra) => extraIds.includes(extra.id)) : undefined;
  const inCart = (variantId: string) =>
    lines.filter((line) => line.productId === product.id && line.variantId === variantId).reduce((total, line) => total + line.quantity, 0);

  return (
    <>
      {sizes.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-bold">{choosePrompt(product.variant_name)}</p>
          <div role="radiogroup" aria-label={product.variant_name || 'Size'} className="flex flex-wrap gap-2">
            {sizes.map((size) => {
              const active = size.id === chosenId;
              const added = inCart(size.id);
              return (
                <button
                  key={size.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChosenId(size.id)}
                  className={cn(
                    'flex min-h-12 flex-col items-start justify-center rounded-[16px] border-[1.5px] px-4 py-1.5 text-left transition-colors active:scale-[0.97]',
                    active ? 'border-brand-500 bg-brand-500/10' : 'border-[var(--line)] bg-[var(--surface)] hover:border-brand-300'
                  )}
                >
                  <span className="text-sm font-extrabold">{size.label}</span>
                  <span className="text-xs font-bold text-[var(--text-muted)]">
                    {formatRupees(Number(size.price))}
                    {added > 0 && <span className="text-brand-600"> · {added} in cart</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {offered.length > 0 && (
        <ExtrasPicker
          extras={offered}
          size={chosen?.label}
          selected={extraIds}
          onToggle={(id) => setExtraIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))}
        />
      )}
      <AddToCartPanel product={product} variant={chosen} extras={chosenExtras} />
      <ProductActionBar product={product} variant={chosen} extras={chosenExtras} />
    </>
  );
}

/** Tick-boxes for a dish's extras, each priced for the chosen size. Shared by the dish page and its sheet. */
export function ExtrasPicker({
  extras,
  size,
  selected,
  onToggle
}: {
  extras: ShopExtra[];
  size: string | undefined;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-bold">Add extras</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {extras.map((extra) => {
          const on = selected.includes(extra.id);
          return (
            <label
              key={extra.id}
              className={cn(
                'flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-[16px] border-[1.5px] px-4 py-2 transition-colors',
                on ? 'border-brand-500 bg-brand-500/10' : 'border-[var(--line)] bg-[var(--surface)] hover:border-brand-300'
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(extra.id)}
                  className="size-5 shrink-0 accent-[var(--color-brand-500)]"
                />
                <span className="text-sm font-bold">{extra.label}</span>
              </span>
              <span className="shrink-0 text-sm font-extrabold text-[var(--text-muted)] tabular-nums">
                +{formatRupees(extraPrice(extra, size))}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
