'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { NearbyProduct } from '@/lib/database.types';
import { useCart } from '@/lib/state/cart';
import { VegMark } from '@/components/ui/badge';
import { Dish } from '@/components/art/dish-photo';
import { dishForProduct } from '@/components/art/dish-map';
import { cn, deliveryMinutes, discountPercent, formatRupees } from '@/lib/utils';
import { comboSummary, variantCount } from '@/lib/menu';
import { MinusIcon, PlusIcon, StarIcon } from '@/components/shell/icons';
import { useChangePulse } from '@/components/motion/use-change-pulse';
import { RollingNumber } from '@/components/motion/rolling-number';
import { VariantSheet } from './variant-sheet';

/** Opening a dish or its shop goes one level deeper: the page slides in from the right. */
const FORWARD = ['nav-forward'];

type Props = {
  product: NearbyProduct;
  /** False on a shop's own page, where the shop name and distance are already in the header. */
  showShop?: boolean;
  /**
   * `card` is the photo-first tile for browsing. `row` is the menu line used on a shop's page and in
   * search: name and price on the left, photo and Add on the right, so a phone shows many dishes at once.
   */
  layout?: 'card' | 'row';
};

export function ProductCard({ product, showShop = true, layout = 'card' }: Props) {
  const sized = (product.variants?.length ?? 0) > 0;
  // With sizes the listed price is the cheapest size, so a strike-through MRP would not line up.
  const off = sized ? null : discountPercent(product.price, product.mrp);
  const soldOut = product.stock <= 0;
  // A product sold in sizes says how many instead of a single unit; one with extras says it can be customised.
  const unit = [sized ? variantCount(product.variants.length, product.variant_name) : product.unit, product.extras?.length ? 'customisable' : '']
    .filter(Boolean)
    .join(' · ');
  // "Pizza Mania + Coke" for a combo, empty otherwise.
  const combo = comboSummary(product.combo_items);
  const comboTag = combo && (
    <span className="rounded-full bg-leaf-600/12 px-2 py-0.5 text-[0.68rem] font-extrabold tracking-wide text-[var(--leaf-ink)]">
      COMBO
    </span>
  );

  const photo = (sizes: string) =>
    product.images?.[0] ? (
      <Image src={product.images[0]} alt={product.name} fill sizes={sizes} className="object-cover" />
    ) : (
      <Dish name={dishForProduct(product)} className="tile-art" sizes={sizes} />
    );

  const price = (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      {sized && <span className="text-xs font-semibold text-[var(--text-muted)]">from</span>}
      <span className="font-display text-lg font-extrabold tracking-[-0.03em] text-brand-600">{formatRupees(product.price)}</span>
      {!sized && product.mrp && product.mrp > product.price && (
        <span className="text-xs font-semibold text-ink-400 line-through">{formatRupees(product.mrp)}</span>
      )}
    </span>
  );

  const shopLine = showShop && (
    <Link
      href={`/shop/${product.seller_id}`} transitionTypes={FORWARD}
      className="block truncate text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--leaf-ink)]"
    >
      {product.seller_name} · {product.distance_km.toFixed(1)} km · ~{deliveryMinutes(product.distance_km, product.eta_minutes)} min
    </Link>
  );

  if (layout === 'row') {
    return (
      <article
        className={cn(
          'flex gap-3.5 rounded-[22px] bg-[var(--surface)] p-3.5 ring-1 ring-[var(--line)] transition-shadow hover:ring-leaf-400',
          soldOut && 'opacity-60'
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <VegMark type={product.veg_type} />
            {comboTag}
            {off !== null && (
              <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[0.68rem] font-extrabold tracking-wide text-brand-600">
                {off}% OFF
              </span>
            )}
          </div>
          <Link href={`/product/${product.id}`} transitionTypes={FORWARD}>
            <h3 className="line-clamp-2 font-display text-[1.02rem] leading-snug font-extrabold tracking-[-0.02em]">
              {product.name}
            </h3>
          </Link>
          <div className="flex flex-wrap items-baseline gap-x-2">
            {price}
            {unit && <span className="text-xs text-[var(--text-muted)]">{unit}</span>}
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--text-muted)]">
            <StarIcon className="size-3.5 text-saffron-500" />
            {product.rating > 0 ? product.rating.toFixed(1) : 'New'}
            {product.rating_count > 0 && <span className="font-semibold">({product.rating_count})</span>}
          </span>
          {combo && <p className="line-clamp-2 text-[0.8rem] leading-snug font-semibold text-[var(--text)]">{combo}</p>}
          {product.description && (
            <p className="line-clamp-2 text-[0.8rem] leading-relaxed text-[var(--text-muted)]">{product.description}</p>
          )}
          {shopLine}
        </div>

        {/* The Add button overlaps the photo's lower edge: one thumb target, always in the same place. */}
        <div className="relative w-[7.5rem] shrink-0 self-start pb-5">
          <Link
            href={`/product/${product.id}`} transitionTypes={FORWARD}
            className="tile relative block aspect-square overflow-hidden rounded-[18px] bg-[var(--tile)]"
          >
            {photo('120px')}
            {soldOut && (
              <span className="absolute inset-x-0 bottom-0 bg-ink-900/80 py-1 text-center text-[0.7rem] font-bold text-white">
                Sold out
              </span>
            )}
          </Link>
          <div className="absolute inset-x-0 bottom-0 flex justify-center">
            <CartControl product={product} />
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-[26px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]',
        'transition-[transform,box-shadow] duration-300 ease-[var(--ease-smooth)]',
        'hover:-translate-y-1.5 hover:ring-leaf-400 hover:shadow-[0_22px_48px_rgb(28_22_20/0.12)]',
        soldOut && 'opacity-60'
      )}
    >
      <Link href={`/product/${product.id}`} transitionTypes={FORWARD} className="block">
        <div className="tile relative aspect-[4/3] w-full bg-[var(--tile)]">
          {photo('(max-width: 640px) 46vw, (max-width: 1024px) 31vw, 23vw')}

          {off !== null && (
            <span className="absolute top-3 left-3 rounded-full bg-brand-500 px-2.5 py-1 text-[0.7rem] font-extrabold tracking-wide text-white">
              {off}% OFF
            </span>
          )}
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[0.74rem] font-extrabold text-ink-900 shadow-sm">
            <StarIcon className="size-3.5 text-saffron-500" />
            {product.rating.toFixed(1)}
          </span>
          {!soldOut && product.listing_mode === 'items' && product.stock <= 5 && (
            <span className="absolute inset-x-0 bottom-0 bg-ink-900/80 py-1.5 text-center text-xs font-bold text-white">
              Only {product.stock} left
            </span>
          )}
          {soldOut && (
            <span className="absolute inset-x-0 bottom-0 bg-ink-900/80 py-1.5 text-center text-xs font-bold text-white">
              Sold out
            </span>
          )}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-3.5 sm:p-4">
        <div className="flex items-start gap-1.5">
          <VegMark type={product.veg_type} />
          <Link href={`/product/${product.id}`} transitionTypes={FORWARD} className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-display text-[1rem] leading-tight font-extrabold tracking-[-0.025em]">
              {product.name}
            </h3>
          </Link>
        </div>

        {combo && (
          <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
            {comboTag}
            <span className="truncate">{combo}</span>
          </p>
        )}

        {shopLine}

        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-3 pt-2">
          <div className="min-w-0">
            {price}
            {unit && <span className="block truncate text-[0.7rem] text-[var(--text-muted)]">{unit}</span>}
          </div>
          <CartControl product={product} />
        </div>
      </div>
    </article>
  );
}

/** A product with sizes or extras is chosen in a sheet; any other is added straight from the menu. */
function CartControl({ product }: { product: NearbyProduct }) {
  return product.variants?.length || product.extras?.length ? (
    <SizedCartControl product={product} />
  ) : (
    <SingleCartControl product={product} />
  );
}

/**
 * ADD opens the sheet: sizes, or sizes and extras. Once some are in the cart the button says how many
 * (across sizes and extras) and opens the sheet again.
 */
function SizedCartControl({ product }: { product: NearbyProduct }) {
  const { quantityOf, ready } = useCart();
  const quantity = quantityOf(product.id);
  const swapped = useChangePulse(quantity > 0 ? 1 : 0, ready);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const soldOut = product.stock <= 0;
  const closed = product.business_open === false;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={soldOut || closed}
        onClick={() => setOpen(true)}
        className={cn(
          'h-11 min-w-[5.5rem] shrink-0 rounded-full px-5 text-sm font-extrabold tracking-wide transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-spring)] active:scale-95 disabled:pointer-events-none disabled:bg-ink-400 disabled:text-white disabled:shadow-none',
          quantity > 0
            ? 'bg-[var(--surface)] text-brand-600 ring-2 ring-brand-500'
            : 'bg-brand-500 text-white shadow-[0_8px_20px_rgb(255_77_28/0.3)] hover:-translate-y-0.5 hover:bg-brand-600',
          swapped.count > 0 && 'animate-pop'
        )}
      >
        {closed ? 'CLOSED' : soldOut ? 'SOLD OUT' : quantity > 0 ? `${quantity} added` : 'ADD'}
      </button>
      {open && <VariantSheet product={product} onClose={close} />}
    </>
  );
}

/** Add, or the − count + stepper once the dish is in the cart. Every target is at least 44px. */
function SingleCartControl({ product }: { product: NearbyProduct }) {
  const { add, setQuantity, quantityOf, ready } = useCart();
  const quantity = quantityOf(product.id);
  // ADD pops into the stepper (and back) only when the person just did it, never on page load.
  const swapped = useChangePulse(quantity > 0 ? 1 : 0, ready);
  const soldOut = product.stock <= 0;
  // A closed shop cannot take an order, so it cannot take a cart either; the shop page says when it opens.
  const closed = product.business_open === false;

  if (quantity === 0) {
    return (
      <button
        type="button"
        disabled={soldOut || closed}
        onClick={() =>
          add({
            productId: product.id,
            sellerId: product.seller_id,
            sellerName: product.seller_name,
            name: product.name,
            unit: product.unit,
            price: product.price,
            mrp: product.mrp,
            vegType: product.veg_type,
            image: product.images?.[0] ?? null
          })
        }
        className={cn(
          'h-11 min-w-[5.5rem] shrink-0 rounded-full bg-brand-500 px-5 text-sm font-extrabold tracking-wide text-white shadow-[0_8px_20px_rgb(255_77_28/0.3)] transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-brand-600 active:scale-95 disabled:pointer-events-none disabled:bg-ink-400 disabled:shadow-none',
          swapped.count > 0 && 'animate-pop'
        )}
      >
        {closed ? 'CLOSED' : soldOut ? 'SOLD OUT' : 'ADD'}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'flex h-11 shrink-0 items-center rounded-full bg-brand-500 text-white shadow-[0_8px_20px_rgb(255_77_28/0.3)]',
        swapped.count > 0 && 'animate-pop'
      )}
    >
      <button
        type="button"
        aria-label={`Remove one ${product.name}`}
        onClick={() => setQuantity(product.id, quantity - 1)}
        className="grid size-11 place-items-center rounded-full transition-transform hover:bg-white/20 active:scale-90"
      >
        <MinusIcon className="size-4" />
      </button>
      <span className="min-w-5 overflow-hidden text-center text-sm font-extrabold tabular-nums" aria-live="polite">
        <RollingNumber value={quantity} />
      </span>
      <button
        type="button"
        aria-label={`Add one ${product.name}`}
        disabled={quantity >= product.stock}
        onClick={() => setQuantity(product.id, quantity + 1)}
        className="grid size-11 place-items-center rounded-full transition-transform hover:bg-white/20 active:scale-90 disabled:opacity-40"
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}
