import Link from 'next/link';
import { Reveal } from '@/components/motion/reveal';
import { Dish } from '@/components/art/dish-photo';
import { dishForSeller } from '@/components/art/dish-map';
import { StarIcon, PinIcon, ClockIcon } from '@/components/shell/icons';
import { FIXTURE_SELLERS } from '@/lib/data/fixtures';
import { formatDistance } from '@/lib/utils';

/** The reference design's "meet the chefs" row, as the shops behind the food. */
export function Shops() {
  const shops = FIXTURE_SELLERS.slice(0, 4);

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-10">
      <Reveal className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[clamp(1.7rem,3.4vw,2.5rem)] leading-[1.04] font-extrabold tracking-[-0.045em]">
            Meet the shops near you
          </h2>
          <p className="mt-2 max-w-[48ch] text-[var(--text-muted)]">
            Family kitchens and corner stores, each one verified and within your radius.
          </p>
        </div>
        <Link href="/browse" className="font-bold text-[var(--leaf-ink)] underline-offset-4 hover:underline">
          Browse all shops →
        </Link>
      </Reveal>

      <div className="mt-9 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {shops.map((shop, index) => (
          <Reveal key={shop.id} delay={index * 80} className="group text-center">
            {/* The badges sit outside the tile: the tile clips its art to the
                circle, which would otherwise cut them in half. */}
            <span className="relative mx-auto block aspect-square w-full max-w-[220px]">
              <span className="tile relative block size-full overflow-hidden rounded-full ring-1 ring-[var(--line)] transition-shadow duration-300 group-hover:shadow-[0_22px_50px_rgb(28_22_20/0.14)]">
                <Dish
                  name={dishForSeller(shop)}
                  className="tile-art"
                  sizes="(max-width: 640px) 60vw, (max-width: 1024px) 30vw, 220px"
                />
              </span>
              <span className="absolute right-1 bottom-2 inline-flex items-center gap-1 rounded-full bg-[var(--surface)] px-2.5 py-1 text-[0.74rem] font-extrabold shadow-md ring-1 ring-[var(--line)]">
                <StarIcon className="size-3.5 text-saffron-500" />
                {shop.rating.toFixed(1)}
              </span>
              {!shop.business_open && (
                <span className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-ink-800/85 px-3 py-1 text-[0.7rem] font-bold whitespace-nowrap text-white">
                  Closed now
                </span>
              )}
            </span>

            <strong className="mt-4 block font-display text-[1.05rem] font-extrabold tracking-[-0.025em]">
              {shop.shop_name}
            </strong>
            <span className="mt-1 block text-[0.82rem] font-bold tracking-[0.1em] text-[var(--leaf-ink)] uppercase">
              {shop.category}
            </span>

            <span className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1">
                <PinIcon className="size-3.5" />
                {formatDistance(shop.distance_km)}
              </span>
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="size-3.5" />
                {shop.eta_minutes} min
              </span>
            </span>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
