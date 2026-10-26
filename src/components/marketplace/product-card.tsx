'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { NearbyProduct } from '@/lib/database.types';
import { useCart } from '@/lib/state/cart';
import { VegMark } from '@/components/ui/badge';
import { Dish } from '@/components/art/dish-photo';
import { dishForProduct } from '@/components/art/dish-map';
import { cn, deliveryMinutes, discountPercent, formatRupees } from '@/lib/utils';
import { MinusIcon, PlusIcon, StarIcon } from '@/components/shell/icons';

/** `showShop` is false on a shop's own page, where the shop name and distance are already in the header. */
export function ProductCard({ product, showShop = true }: { product: NearbyProduct; showShop?: boolean }) {
  const { add, setQuantity, quantityOf } = useCart();
  const quantity = quantityOf(product.id);
  const off = discountPercent(product.price, product.mrp);
  const soldOut = product.stock <= 0;

  function addToCart() {
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
    });
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
      <Link href={`/product/${product.id}`} className="block">
        <div className="tile relative aspect-[4/3] w-full bg-[var(--tile)]">
          {product.images?.[0] ? (
            <Image
              src={product.images[0]}
              alt={product.name}
              fill
              sizes="(max-width: 640px) 46vw, (max-width: 1024px) 31vw, 23vw"
              className="object-cover"
            />
          ) : (
            <Dish
              name={dishForProduct(product)}
              className="tile-art"
              sizes="(max-width: 640px) 46vw, (max-width: 1024px) 31vw, 23vw"
            />
          )}

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

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start gap-1.5">
          <VegMark type={product.veg_type} />
          <Link href={`/product/${product.id}`} className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-display text-[1rem] leading-tight font-extrabold tracking-[-0.025em]">
              {product.name}
            </h3>
          </Link>
        </div>

        {showShop && (
          <>
        <Link
          href={`/shop/${product.seller_id}`}
          className="truncate text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--leaf-ink)]"
        >
          {product.seller_name}
        </Link>

        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
          <span>{product.distance_km.toFixed(1)} km</span>
          <span aria-hidden>·</span>
          <span>~{deliveryMinutes(product.distance_km, product.eta_minutes)} min</span>
        </div>
          </>
        )}

        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-3 pt-3">
          <div className="min-w-0">
            <span className="block text-[0.64rem] font-bold tracking-[0.14em] text-ink-400 uppercase">
              Price
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-display text-lg font-extrabold tracking-[-0.03em] text-brand-600">
                {formatRupees(product.price)}
              </span>
              {product.mrp && product.mrp > product.price && (
                <span className="text-xs font-semibold text-ink-400 line-through">
                  {formatRupees(product.mrp)}
                </span>
              )}
            </span>
            {product.unit && (
              <span className="block truncate text-[0.7rem] text-[var(--text-muted)]">{product.unit}</span>
            )}
          </div>

          {quantity === 0 ? (
            <button
              type="button"
              disabled={soldOut}
              onClick={addToCart}
              className="h-10 shrink-0 rounded-full bg-brand-500 px-4 text-sm font-extrabold tracking-wide text-white shadow-[0_8px_20px_rgb(255_77_28/0.3)] transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-brand-600 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              ADD
            </button>
          ) : (
            <div className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-brand-500 px-1 text-white shadow-[0_8px_20px_rgb(255_77_28/0.3)]">
              <button
                type="button"
                aria-label="Remove one"
                onClick={() => setQuantity(product.id, quantity - 1)}
                className="grid size-8 place-items-center rounded-full transition-transform hover:bg-white/20 active:scale-90"
              >
                <MinusIcon className="size-3.5" />
              </button>
              <span className="min-w-5 text-center text-sm font-extrabold tabular-nums">{quantity}</span>
              <button
                type="button"
                aria-label="Add one"
                disabled={quantity >= product.stock}
                onClick={() => setQuantity(product.id, quantity + 1)}
                className="grid size-8 place-items-center rounded-full transition-transform hover:bg-white/20 active:scale-90 disabled:opacity-40"
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
