'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn, formatRupees, discountPercent } from '@/lib/utils';
import { Reveal } from '@/components/motion/reveal';
import { Dish } from '@/components/art/dish-photo';
import { photoForProduct } from '@/components/art/product-photo';
import { PlusIcon, StarIcon } from '@/components/shell/icons';
import { FIXTURE_PRODUCTS, FIXTURE_CATEGORY_LABELS } from '@/lib/data/fixtures';

const FILTERS = ['all', 'biryani', 'tiffins', 'kebabs', 'desserts', 'beverages', 'staples'] as const;

export function MenuBoard() {
  const [active, setActive] = React.useState<string>('all');

  const items = React.useMemo(() => {
    const pool = active === 'all' ? FIXTURE_PRODUCTS : FIXTURE_PRODUCTS.filter((p) => p.category_key === active);
    return pool.slice(0, 8);
  }, [active]);

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-10">
      <Reveal className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-[clamp(1.7rem,3.4vw,2.5rem)] leading-[1.04] font-extrabold tracking-[-0.045em]">
            Top categories
          </h2>
          <p className="mt-2 text-[var(--text-muted)]">
            Pick a craving — we only show what a nearby shop can actually send.
          </p>
        </div>
        <Link href="/browse" className="font-bold text-[var(--leaf-ink)] underline-offset-4 hover:underline">
          See the full catalogue →
        </Link>
      </Reveal>

      <Reveal delay={60} className="no-scrollbar mt-6 flex gap-2.5 overflow-x-auto pb-1">
        {FILTERS.map((key) => {
          const selected = key === active;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              aria-pressed={selected}
              className={cn(
                'shrink-0 rounded-full border px-5 py-2.5 text-[0.92rem] font-bold transition-[transform,background-color,border-color,color,box-shadow] duration-200 active:scale-[0.96]',
                selected
                  ? 'border-leaf-600 bg-leaf-600 text-white shadow-[0_10px_24px_rgb(36_101_64/0.3)]'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)]'
              )}
            >
              {key === 'all' ? 'All' : FIXTURE_CATEGORY_LABELS[key]}
            </button>
          );
        })}
      </Reveal>

      <h3 className="mt-12 font-display text-[clamp(1.5rem,3vw,2.2rem)] font-extrabold tracking-[-0.045em]">
        On the menu today
      </h3>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, index) => {
          const off = discountPercent(item.price, item.mrp);
          return (
            <Reveal
              key={item.id}
              delay={index * 55}
              className="group relative flex flex-col overflow-hidden rounded-[26px] border border-[var(--line)] bg-[var(--surface)] shadow-sm transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1.5 hover:border-leaf-200 hover:shadow-[0_22px_48px_rgb(28_22_20/0.12)]"
            >
              <div className="tile relative aspect-[4/3] w-full bg-[var(--tile)]">
                <Dish
                  name={photoForProduct(item)}
                  className="tile-art"
                  sizes="(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 23vw"
                />

                {off !== null && (
                  <span className="absolute top-3.5 left-3.5 rounded-full bg-brand-500 px-2.5 py-1 text-[0.7rem] font-extrabold tracking-wide text-white">
                    {off}% OFF
                  </span>
                )}
                <span className="absolute top-3.5 right-3.5 inline-flex items-center gap-1 rounded-full bg-[var(--surface)]/95 px-2.5 py-1 text-[0.74rem] font-extrabold shadow-sm">
                  <StarIcon className="size-3.5 text-saffron-500" />
                  {item.rating.toFixed(1)}
                </span>
              </div>

              <div className="flex flex-1 flex-col p-4.5">
                <strong className="font-display text-[1.02rem] leading-tight font-extrabold tracking-[-0.025em]">
                  {item.name}
                </strong>
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-[var(--text-muted)]">
                  {item.description}
                </p>

                <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                  <span>
                    <span className="block text-[0.7rem] font-bold tracking-[0.14em] text-ink-400 uppercase">
                      Price
                    </span>
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-display text-lg font-extrabold text-brand-600">
                        {formatRupees(item.price)}
                      </span>
                      {item.mrp && item.mrp > item.price && (
                        <span className="text-sm font-semibold text-ink-400 line-through">
                          {formatRupees(item.mrp)}
                        </span>
                      )}
                    </span>
                  </span>

                  <Link
                    href={'/browse?product=' + item.id}
                    aria-label={'Add ' + item.name + ' to cart'}
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-leaf-600 text-white shadow-[0_8px_20px_rgb(36_101_64/0.3)] transition-[transform,background-color] duration-200 hover:scale-110 hover:bg-leaf-700 active:scale-95"
                  >
                    <PlusIcon className="size-5" />
                  </Link>
                </div>

                <span className="mt-3 truncate border-t pt-3 text-[0.78rem] font-semibold text-[var(--text-muted)]">
                  {item.seller_name} · {item.eta_minutes} min
                </span>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
