import Link from 'next/link';
import type { NearbySeller } from '@/lib/database.types';
import { ShopArt } from '@/components/marketplace/shop-art';
import { cn, deliveryMinutes, formatDistance, formatRupees } from '@/lib/utils';
import { ClockIcon, PinIcon, StarIcon } from '@/components/shell/icons';

/**
 * A restaurant poster: a wide photo with the name set over a dark fade, then a
 * compact strip of what matters when choosing where to order from.
 */
export function ShopCard({ shop }: { shop: NearbySeller }) {
  return (
    <Link
      href={`/shop/${shop.id}`}
      className={cn(
        'group flex flex-col overflow-hidden rounded-[26px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]',
        'transition-[transform,box-shadow] duration-300 ease-[var(--ease-smooth)]',
        'hover:-translate-y-1.5 hover:ring-leaf-400 hover:shadow-[0_22px_48px_rgb(28_22_20/0.12)]'
      )}
    >
      <span className="tile relative block aspect-[16/9] w-full overflow-hidden bg-[var(--tile)]">
        <ShopArt
          shop={shop}
          sizes="(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 30vw"
          className={cn(
            'transition-transform duration-500 ease-[var(--ease-smooth)] group-hover:scale-[1.06]',
            !shop.business_open && 'grayscale'
          )}
        />
        <span aria-hidden className="absolute inset-0 bg-linear-to-t from-ink-900/80 via-ink-900/10 to-transparent" />

        <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[0.74rem] font-extrabold text-ink-900 shadow-sm">
          <StarIcon className="size-3.5 text-saffron-500" />
          {shop.rating > 0 ? shop.rating.toFixed(1) : 'New'}
        </span>
        {!shop.business_open && (
          <span className="absolute top-3 left-3 rounded-full bg-ink-900/85 px-2.5 py-1 text-[0.7rem] font-bold text-white">
            Closed now
          </span>
        )}

        <span className="absolute inset-x-4 bottom-3 block">
          <strong className="block truncate font-display text-[1.25rem] leading-tight font-extrabold tracking-[-0.03em] text-white">
            {shop.shop_name}
          </strong>
          <span className="block truncate text-[0.72rem] font-bold tracking-[0.12em] text-white/85 uppercase">
            {shop.category}
          </span>
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3.5 text-xs font-semibold text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1">
          <PinIcon className="size-3.5" />
          {formatDistance(shop.distance_km)}
        </span>
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="size-3.5" />
          ~{deliveryMinutes(shop.distance_km, shop.eta_minutes)} min
        </span>
        {shop.min_order_amount > 0 && <span>Min {formatRupees(shop.min_order_amount)}</span>}
        {shop.free_delivery_above > 0 ? (
          <span className="rounded-full bg-[var(--leaf-soft)] px-2.5 py-1 text-[0.68rem] font-extrabold text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
            Free delivery over {formatRupees(shop.free_delivery_above)}
          </span>
        ) : (
          shop.cod_available && <span className="text-[var(--leaf-ink)]">Cash on delivery</span>
        )}
      </span>
    </Link>
  );
}
