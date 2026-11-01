import Link from 'next/link';
import { Dish, type DishKey } from '@/components/art/dish-photo';
import { StarIcon, ClockIcon, PinIcon } from '@/components/shell/icons';

const SPECIALITIES: Array<{ art: DishKey; title: string; body: string }> = [
  { art: 'biryani', title: 'Biryani', body: 'Dum-cooked handis, sealed and opened at your door.' },
  { art: 'dosa', title: 'Tiffins', body: 'Idli, dosa and filter coffee from six in the morning.' },
  { art: 'kebab', title: 'Kebabs', body: 'Charcoal grills, packed hot straight off the skewer.' },
  { art: 'sweet', title: 'Sweets', body: 'Double ka meetha and mithai made the same day.' },
  { art: 'kirana', title: 'Kirana', body: 'Rice, dal and oil from the shop down the road.' }
];

const primaryCta =
  'inline-flex h-14 items-center justify-center rounded-full bg-brand-500 px-8 text-base font-bold text-white shadow-ember transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_16px_38px_rgb(255_77_28/0.42)] active:scale-[0.97]';
const secondaryCta =
  'inline-flex h-14 items-center justify-center rounded-full border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-8 text-base font-bold transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-500 hover:text-[var(--leaf-ink)] active:scale-[0.97]';

export function Hero() {
  return (
    <section className="mx-auto max-w-7xl px-5 pt-6 pb-14 sm:px-8 lg:px-10 lg:pt-12 lg:pb-20">
      <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        {/* ---------- copy ---------- */}
        <div>
          <p className="animate-rise inline-flex items-center gap-2.5 rounded-full border border-leaf-200 bg-[var(--leaf-soft)] px-4 py-2 text-eyebrow text-[var(--leaf-ink)] uppercase">
            <span className="animate-ping-ring size-1.5 rounded-full bg-leaf-500" />
            Local marketplace
          </p>

          <h1 className="animate-rise mt-5 max-w-[14ch] text-balance font-display text-[clamp(2.5rem,8.5vw,5.2rem)] leading-[0.98] font-extrabold tracking-[-0.055em] [animation-delay:90ms]">
            Real food from the shops on your <span className="text-brand-500">own street</span>
          </h1>

          <p className="animate-rise mt-4 max-w-[40ch] text-base leading-relaxed text-[var(--text-muted)] [animation-delay:130ms] sm:text-lg">
            Order from kitchens and kiranas within a few km of your door, packed fresh and brought by a rider from
            your area.
          </p>

          <div className="animate-rise mt-7 flex flex-col gap-3 [animation-delay:170ms] sm:flex-row">
            <Link href="/browse" className={primaryCta}>
              Explore nearby shops
            </Link>
            <Link href="/business/apply" className={secondaryCta}>
              List your shop
            </Link>
          </div>

          <ul className="animate-rise mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-[var(--text-muted)] [animation-delay:210ms]">
            <li className="inline-flex items-center gap-1.5">
              <ClockIcon className="size-4 text-leaf-600" />
              About 32 min
            </li>
            <li className="inline-flex items-center gap-1.5">
              <StarIcon className="size-4 text-saffron-500" />
              4.7 from 1.2k orders
            </li>
            <li className="inline-flex items-center gap-1.5">
              <PinIcon className="size-4 text-leaf-600" />
              Pick 1, 3, 5 or 10 km
            </li>
          </ul>
        </div>

        {/* ---------- photos ---------- */}
        <div className="animate-rise relative [animation-delay:150ms]">
          {/* phone: swipeable carousel */}
          <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 sm:hidden">
            <div className="tile relative aspect-[4/4.4] w-[80%] shrink-0 snap-center overflow-hidden rounded-[28px] shadow-[0_18px_40px_rgb(28_22_20/0.18)] ring-1 ring-[var(--line)]">
              <Dish name="biryani" priority className="tile-art" sizes="80vw" />
              <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-[var(--surface)]/95 px-3 py-1.5 text-xs font-bold shadow-lg ring-1 ring-[var(--line)]">
                <StarIcon className="size-3.5 text-saffron-500" />
                4.7
                <span className="font-semibold text-[var(--text-muted)]">· 1.2k orders</span>
              </div>
              <div className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-leaf-600 px-3 py-2 text-xs font-bold text-white shadow-lg">
                <ClockIcon className="size-3.5" />
                32 min · ₹0 delivery
              </div>
            </div>
            {(['kebab', 'dosa'] as const).map((name) => (
              <div
                key={name}
                className="tile relative aspect-[4/4.4] w-[64%] shrink-0 snap-center overflow-hidden rounded-[28px] ring-1 ring-[var(--line)]"
              >
                <Dish name={name} className="tile-art" sizes="65vw" />
              </div>
            ))}
          </div>

          {/* tablet and desktop: collage */}
          <div className="hidden sm:block">
            <div aria-hidden className="pointer-events-none absolute -top-10 -right-10 size-72 rounded-full bg-saffron-300/30 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-12 -left-10 size-72 rounded-full bg-leaf-300/25 blur-3xl" />

            <div className="relative grid grid-cols-[1.35fr_1fr] gap-4 lg:gap-5">
              <div className="animate-float relative row-span-2 aspect-[4/5] overflow-hidden rounded-[32px] shadow-[0_26px_50px_rgb(28_22_20/0.22)] ring-1 ring-[var(--line)]">
                <Dish name="biryani" priority sizes="(max-width: 1024px) 55vw, 30vw" />
              </div>
              <div className="animate-sway relative aspect-square overflow-hidden rounded-[28px] shadow-lg ring-1 ring-[var(--line)]">
                <Dish name="kebab" sizes="(max-width: 1024px) 38vw, 20vw" />
              </div>
              <div className="animate-float relative aspect-square overflow-hidden rounded-[28px] shadow-lg ring-1 ring-[var(--line)] [animation-delay:1.2s]">
                <Dish name="dosa" sizes="(max-width: 1024px) 38vw, 20vw" />
              </div>
            </div>

            <div className="absolute top-5 left-5 flex items-center gap-2 rounded-full bg-[var(--surface)]/95 px-3.5 py-2 text-sm font-bold shadow-lg ring-1 ring-[var(--line)]">
              <StarIcon className="size-4 text-saffron-500" />
              4.7
              <span className="font-semibold text-[var(--text-muted)]">· 1.2k orders</span>
            </div>
            <div className="absolute bottom-5 left-5 flex items-center gap-2 rounded-full bg-leaf-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_12px_28px_rgb(36_101_64/0.35)]">
              <ClockIcon className="size-4" />
              32 min · ₹0 delivery
            </div>
          </div>
        </div>
      </div>

      {/* ---------- specialities ---------- */}
      <div className="mt-10 lg:mt-14">
        <p className="mb-3 text-eyebrow text-[var(--text-muted)] uppercase">What are you craving?</p>

        {/* phone: swipeable chips */}
        <div className="no-scrollbar -mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1 sm:hidden">
          {SPECIALITIES.map((item) => (
            <Link
              key={item.title}
              href="/browse"
              className="flex min-h-12 shrink-0 snap-start items-center gap-2.5 rounded-full border border-[var(--line)] bg-[var(--surface)] py-1.5 pr-4 pl-1.5 active:scale-[0.97]"
            >
              <span className="tile relative size-9 shrink-0 overflow-hidden rounded-full ring-1 ring-[var(--line)]">
                <Dish name={item.art} className="tile-art" sizes="36px" />
              </span>
              <span className="font-display text-sm font-extrabold tracking-[-0.01em]">{item.title}</span>
            </Link>
          ))}
        </div>

        {/* tablet and desktop: cards */}
        <div className="hidden gap-4 sm:grid sm:grid-cols-3 lg:grid-cols-5">
          {SPECIALITIES.map((item, index) => (
            <Link
              key={item.title}
              href="/browse"
              className="animate-rise group flex flex-col gap-3 rounded-[24px] border border-[var(--line)] bg-[var(--surface)]/80 p-4 transition-[transform,background-color,border-color] hover:-translate-y-1 hover:border-leaf-300 hover:bg-[var(--leaf-soft)]"
              style={{ animationDelay: 240 + index * 70 + 'ms' }}
            >
              <span className="tile relative size-14 shrink-0 overflow-hidden rounded-full ring-1 ring-[var(--line)] transition-transform group-hover:scale-105">
                <Dish name={item.art} className="tile-art" sizes="56px" />
              </span>
              <span>
                <strong className="block font-display text-base font-extrabold tracking-[-0.02em]">{item.title}</strong>
                <span className="mt-1 block text-sm leading-relaxed text-[var(--text-muted)]">{item.body}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
