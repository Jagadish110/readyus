import Link from 'next/link';
import type { NearbySeller } from '@/lib/database.types';
import { ShopArt } from '@/components/marketplace/shop-art';
import { cn, deliveryMinutes, formatDistance, opensAt } from '@/lib/utils';
import { StarIcon } from '@/components/shell/icons';

/**
 * Every kitchen in range as one swipeable row of small tiles, so the dishes below are a thumb's reach away.
 * On wider screens the row simply wraps.
 */
export function ShopStrip({ shops }: { shops: NearbySeller[] }) {
  return (
    <ul className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {shops.map((shop) => (
        <li key={shop.id} className="w-[9.5rem] shrink-0 snap-start sm:w-44">
          <ShopTile shop={shop} />
        </li>
      ))}
    </ul>
  );
}

function ShopTile({ shop }: { shop: NearbySeller }) {
  const closedNote = !shop.business_open
    ? opensAt(shop.open_time, shop.close_time)
      ? `Opens ${opensAt(shop.open_time, shop.close_time)}`
      : 'Closed now'
    : null;

  return (
    <Link
      href={`/shop/${shop.id}`}
      transitionTypes={['nav-forward']}
      className="group block rounded-[20px] transition-transform duration-200 active:scale-[0.97]"
    >
      <span className="tile relative block aspect-[4/3] overflow-hidden rounded-[18px] bg-[var(--tile)] ring-1 ring-[var(--line)]">
        <ShopArt
          shop={shop}
          sizes="176px"
          className={cn('transition-transform duration-500 group-hover:scale-[1.06]', !shop.business_open && 'grayscale')}
        />
        <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-white/95 px-2 py-0.5 text-[0.7rem] font-extrabold text-ink-900 shadow-sm">
          <StarIcon className="size-3 text-saffron-500" />
          {shop.rating > 0 ? shop.rating.toFixed(1) : 'New'}
        </span>
        {closedNote && (
          <span className="absolute inset-x-0 bottom-0 bg-ink-900/80 py-1 text-center text-[0.68rem] font-bold text-white">
            {closedNote}
          </span>
        )}
      </span>
      <span className="mt-2 block truncate font-display text-[0.95rem] leading-tight font-extrabold tracking-[-0.02em]">
        {shop.shop_name}
      </span>
      <span className="block truncate text-xs font-semibold text-[var(--text-muted)]">
        {formatDistance(shop.distance_km)} · ~{deliveryMinutes(shop.distance_km, shop.eta_minutes)} min
      </span>
    </Link>
  );
}
