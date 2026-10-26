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

export function Hero() {
  return (
    <section className="mx-auto max-w-7xl px-5 pt-8 pb-16 sm:px-8 lg:px-10 lg:pt-12">
      <p className="animate-rise inline-flex items-center gap-2.5 rounded-full border border-leaf-200 bg-[var(--leaf-soft)] px-4 py-2 text-eyebrow text-[var(--leaf-ink)] uppercase">
        <span className="animate-ping-ring size-1.5 rounded-full bg-leaf-500" />
        Local marketplace · Hyderabad
      </p>

      <h1 className="animate-rise mt-6 max-w-[18ch] font-display text-[clamp(2.4rem,6.2vw,4.6rem)] leading-[0.95] font-extrabold tracking-[-0.055em] [animation-delay:90ms]">
        &ldquo;Real food from the shops on your own street&rdquo;
      </h1>

      {/* On a phone the main action sits right under the headline, above the photos. */}
      <div className="animate-rise mt-6 grid gap-3 [animation-delay:130ms] sm:grid-cols-2 md:hidden">
        <Link
          href="/browse"
          className="inline-flex h-13 items-center justify-center rounded-full bg-brand-500 px-7 font-bold text-white shadow-ember active:scale-[0.97]"
        >
          Explore nearby shops
        </Link>
        <Link
          href="/business/apply"
          className="inline-flex h-13 items-center justify-center rounded-full border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-7 font-bold active:scale-[0.97]"
        >
          List your shop
        </Link>
      </div>

      <div className="mt-8 grid items-start gap-7 md:mt-10 lg:grid-cols-[1.25fr_0.75fr]">
        {/* ---------- hero collage ---------- */}
        <div className="animate-rise group relative [animation-delay:170ms]">
          <div className="tile relative overflow-hidden rounded-[34px] bg-linear-160 from-[var(--tile)] via-[var(--surface)] to-[var(--leaf-soft)] p-6 shadow-[0_18px_60px_rgb(28_22_20/0.10)] ring-1 ring-[var(--line)] sm:p-8">
            {/* soft blooms behind the plate */}
            <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-saffron-300/30 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-20 size-72 rounded-full bg-leaf-300/25 blur-3xl" />

            <div className="tile-art relative grid gap-5 sm:grid-cols-[1.4fr_1fr]">
              <div className="animate-float relative aspect-square overflow-hidden rounded-[28px] shadow-[0_26px_50px_rgb(28_22_20/0.22)] ring-1 ring-[var(--line)]">
                <Dish
                  name="biryani"
                  priority
                  sizes="(max-width: 640px) 92vw, (max-width: 1024px) 48vw, 38vw"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-1">
                <div className="animate-sway relative aspect-square overflow-hidden rounded-[26px] shadow-lg ring-1 ring-[var(--line)]">
                  <Dish name="kebab" sizes="(max-width: 640px) 44vw, 20vw" />
                </div>
                <div className="animate-float relative aspect-square overflow-hidden rounded-[26px] shadow-lg ring-1 ring-[var(--line)] [animation-delay:1.2s]">
                  <Dish name="dosa" sizes="(max-width: 640px) 44vw, 20vw" />
                </div>
              </div>
            </div>

            {/* floating proof chips */}
            <div className="pointer-events-none absolute top-7 left-7 flex items-center gap-2 rounded-full bg-[var(--surface)]/95 px-3.5 py-2 text-sm font-bold shadow-lg ring-1 ring-[var(--line)]">
              <StarIcon className="size-4 text-saffron-500" />
              4.7
              <span className="font-semibold text-[var(--text-muted)]">· 1.2k orders</span>
            </div>

            <div className="pointer-events-none absolute right-7 bottom-7 flex items-center gap-2 rounded-full bg-leaf-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_12px_28px_rgb(36_101_64/0.35)]">
              <ClockIcon className="size-4" />
              32 min · ₹0 delivery
            </div>
          </div>

          <div className="mt-5 hidden flex-wrap items-center gap-3 md:flex">
            <Link
              href="/browse"
              className="inline-flex h-13 items-center rounded-full bg-brand-500 px-7 font-bold text-white shadow-ember transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_16px_38px_rgb(255_77_28/0.42)] active:scale-[0.97]"
            >
              Explore nearby shops
            </Link>
            <Link
              href="/business/apply"
              className="inline-flex h-13 items-center rounded-full border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-7 font-bold transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-500 hover:text-[var(--leaf-ink)]"
            >
              List your shop
            </Link>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--text-muted)]">
              <PinIcon className="size-4 text-leaf-600" />
              Set your radius: 1, 3, 5 or 10 km
            </span>
          </div>
        </div>

        {/* ---------- specialities ---------- */}
        <div className="grid gap-2">
          {SPECIALITIES.map((item, index) => (
            <div
              key={item.title}
              className="animate-rise group flex items-center gap-4 rounded-2xl p-3 transition-colors hover:bg-[var(--surface)]"
              style={{ animationDelay: 240 + index * 70 + 'ms' }}
            >
              <span className="tile relative size-16 shrink-0 overflow-hidden rounded-2xl ring-1 ring-[var(--line)]">
                <Dish name={item.art} className="tile-art" sizes="64px" />
              </span>
              <span className="min-w-0">
                <strong className="block font-display text-[1.05rem] font-extrabold tracking-[-0.02em]">
                  {item.title}
                </strong>
                <span className="block text-sm leading-relaxed text-[var(--text-muted)]">{item.body}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
