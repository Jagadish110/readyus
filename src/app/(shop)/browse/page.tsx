import Link from 'next/link';
import type { ListingMode } from '@/lib/database.types';
import { readLocation } from '@/lib/data/location';
import { getNearbyCategories, getNearbyProducts, getNearbySellers, usingFixtures } from '@/lib/data/marketplace';
import { LocationGate } from '@/components/shell/location-gate';
import { ModeSwitch } from '@/components/marketplace/mode-switch';
import { DietFilter } from '@/components/marketplace/diet-filter';
import { CategoryRail } from '@/components/marketplace/category-rail';
import { ProductCard } from '@/components/marketplace/product-card';
import { SearchPrompt } from '@/components/marketplace/search-prompt';
import { ShopCard } from '@/components/marketplace/shop-card';
import { foodCategoryRail } from '@/lib/data/food-categories';
import { Dish, type PhotoKey } from '@/components/art/dish-photo';
import { Reveal } from '@/components/motion/reveal';
import { SectionTitle } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { SampleAreaButton } from '@/components/shell/sample-area-button';

const DIET_LABEL: Record<string, string> = { veg: 'Veg', non_veg: 'Non-veg', egg: 'Egg' };

/** A headline for the hour in India, since the server may run on another timezone. */
function mealPrompt() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()));
  if (hour >= 5 && hour < 11) return 'What’s for breakfast?';
  if (hour >= 11 && hour < 16) return 'What’s for lunch?';
  if (hour >= 16 && hour < 19) return 'Time for a snack?';
  if (hour >= 19 && hour < 23) return 'What’s for dinner?';
  return 'Late-night cravings?';
}

type SearchParams = Promise<{
  mode?: string;
  category?: string;
  diet?: string;
}>;

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode: ListingMode = params.mode === 'items' ? 'items' : 'food';
  const category = params.category;
  const diet = mode === 'food' && ['veg', 'non_veg', 'egg'].includes(params.diet ?? '') ? params.diet : undefined;

  // No Suspense placeholder here on purpose: a page that shows a fallback while a page transition runs
  // makes the browser abandon the slide. Like the shop and dish pages, browse arrives complete; a filter
  // change keeps the current results on screen and crossfades to the new ones (see RouteTransition).
  return (
    <LocationGate>
      <BrowseContent mode={mode} category={category} diet={diet} />
    </LocationGate>
  );
}

async function BrowseContent({ mode, category, diet }: { mode: ListingMode; category?: string; diet?: string }) {
  const location = await readLocation();

  // The gate renders the picker; this only runs once a pin exists.
  if (!location) return <BrowseSkeleton />;

  if (mode === 'items') return <ItemsComingSoon radiusKm={location.radiusKm} />;

  const query = {
    lat: location.lat,
    lng: location.lng,
    radiusKm: location.radiusKm,
    mode
  };

  const [shops, allProducts, categories] = await Promise.all([
    getNearbySellers(query),
    // Every dish from every kitchen in range, listed one after another under the kitchens.
    getNearbyProducts({ ...query, category, limit: 200 }),
    getNearbyCategories(query)
  ]);

  // Veg / non-veg is a property of each dish, so it narrows the menu, not the shops.
  const products = diet ? allProducts.filter((product) => product.veg_type === diet) : allProducts;

  // Picking a category or diet means the customer wants a dish, so the shop
  // list steps aside and only matching dishes remain.
  const focused = Boolean(category || diet);
  const nothingNearby = focused ? false : !shops.length && !products.length;

  const rail = foodCategoryRail(categories);
  const openCount = shops.filter((shop) => shop.business_open).length;
  // Open kitchens first; each group stays nearest first, as the server sorted it.
  const shopsOpenFirst = [...shops].sort((a, b) => Number(b.business_open) - Number(a.business_open));
  const filterTitle = [diet && DIET_LABEL[diet], rail.find((entry) => entry.category_key === category)?.name ?? (category && 'Matching items')]
    .filter(Boolean)
    .join(' · ');

  return (
    // A column of flex items, not a grid: a sticky grid item could only stick within its own row.
    <div className="flex min-w-0 flex-col gap-5 sm:gap-7">
      {usingFixtures() && (
        <p className="animate-rise rounded-[18px] bg-warning/12 px-4 py-2.5 text-sm font-medium text-[var(--text)] ring-1 ring-warning/35">
          Showing sample data. Connect a Supabase project to load real shops.
        </p>
      )}

      {/* Everything down to the first row of shops is above the fold, so it
          animates with CSS instead of waiting for the reveal observer. */}
      <BrowseHero
        mode={mode}
        radiusKm={location.radiusKm}
        title={mealPrompt()}
        dishes={['biryani', 'chai', 'dosa']}
        steam
        status={
          <>
            {openCount > 0 && (
              <span aria-hidden className="relative flex size-2.5 shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-leaf-300 opacity-70" />
                <span className="relative size-2.5 rounded-full bg-leaf-300" />
              </span>
            )}
            {shops.length === 0
              ? 'No kitchens in range yet'
              : openCount > 0
                ? `${openCount} ${openCount === 1 ? 'kitchen' : 'kitchens'} open now, ${shops.length} nearby`
                : `${shops.length} ${shops.length === 1 ? 'kitchen' : 'kitchens'} nearby, all closed right now`}
          </>
        }
      >
        <SearchPrompt />
      </BrowseHero>

      {/* Stays in reach while scrolling the menu. On a phone it sits at the very top, where the header slides away. */}
      <div className="glass animate-rise sticky top-0 z-30 -mx-4 px-4 py-2 [animation-delay:70ms] sm:mx-0 sm:rounded-full sm:px-2.5 sm:ring-1 sm:ring-[var(--line)] md:top-[84px]">
        <CategoryRail
          categories={rail}
          active={category}
          leading={
            <>
              <DietFilter active={diet} />
              <span aria-hidden className="h-6 w-px shrink-0 bg-[var(--line)]" />
            </>
          }
        />
      </div>

      {nothingNearby ? (
        <EmptyRadius radiusKm={location.radiusKm} />
      ) : (
        <>
          {!focused && shops.length > 0 && (
            <section className="grid grid-cols-1 gap-4">
              <div className="animate-rise flex items-baseline justify-between gap-3 [animation-delay:120ms]">
                <SectionTitle>Kitchens near you</SectionTitle>
                <span className="shrink-0 text-xs font-bold text-[var(--text-muted)]">
                  {shops.length} {shops.length === 1 ? 'kitchen' : 'kitchens'}
                </span>
              </div>
              {/* A swipeable row on a phone, so the menu below stays a thumb's reach away; a grid on wider screens. */}
              <ul className="no-scrollbar -mx-4 -my-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-2 sm:mx-0 sm:my-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:py-0 lg:grid-cols-3">
                {shopsOpenFirst.map((shop, index) => (
                  <li
                    key={shop.id}
                    className="animate-rise w-[82%] shrink-0 snap-start only:w-full sm:w-auto"
                    style={{ animationDelay: 150 + Math.min(index, 5) * 70 + 'ms' }}
                  >
                    <ShopCard shop={shop} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {products.length === 0 && !focused && (
            <p className="animate-rise rounded-[18px] bg-[var(--tile)] px-4 py-3 text-sm text-[var(--text-muted)]">
              These shops have not listed any food for ordering yet. It will appear here as soon as they do.
            </p>
          )}

          {focused && products.length === 0 && (
            <div className="animate-rise mx-auto grid max-w-md justify-items-center gap-3 rounded-[26px] bg-[var(--surface)] p-7 text-center shadow-sm ring-1 ring-[var(--line)]">
              <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Nothing matches that nearby</h2>
              <p className="text-sm text-[var(--text-muted)]">Try another filter, or see everything these kitchens are serving.</p>
              <ClearFilters />
            </div>
          )}

          {products.length > 0 && (
            <section className="grid grid-cols-1 gap-4">
              <Reveal as="div" className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <SectionTitle>{focused ? filterTitle : 'On the menu today'}</SectionTitle>
                  <span className="shrink-0 text-xs font-bold text-[var(--text-muted)]">
                    {products.length} {products.length === 1 ? 'dish' : 'dishes'}
                  </span>
                </div>
                {focused && <ClearFilters />}
              </Reveal>
              {/* Phones get full-width menu rows (name, shop and price fit on one line); wider screens get photo cards. */}
              <div className="grid gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
                {products.map((product, index) => (
                  <Reveal key={product.id} delay={(index % 4) * 55}>
                    <div className="sm:hidden">
                      <ProductCard product={product} layout="row" />
                    </div>
                    <div className="hidden h-full sm:block">
                      <ProductCard product={product} />
                    </div>
                  </Reveal>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ClearFilters() {
  return (
    <Link
      href="/browse?mode=food"
      scroll={false}
      transitionTypes={['nav-filter']}
      className="inline-flex h-11 shrink-0 items-center rounded-full bg-[var(--leaf-soft)] px-4 text-sm font-bold text-[var(--leaf-ink)] transition-transform active:scale-[0.96]"
    >
      Clear filters
    </Link>
  );
}

/** The green panel that opens both the Food and Items tabs, so the two always match. */
function BrowseHero({
  mode,
  radiusKm,
  title,
  status,
  dishes,
  steam,
  children
}: {
  mode: ListingMode;
  radiusKm: number;
  title: string;
  status: React.ReactNode;
  dishes: [PhotoKey, PhotoKey, PhotoKey];
  steam?: boolean;
  children: React.ReactNode;
}) {
  return (
    <header className="animate-rise relative isolate overflow-hidden rounded-[30px] bg-leaf-800 p-5 text-white shadow-[0_18px_44px_rgb(23_64_42/0.28)] sm:p-8">
      <span aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_90%_at_88%_10%,rgb(255_176_32/0.24),transparent_65%)]" />
      <HeroDishes dishes={dishes} steam={steam} />

      <div className="grid gap-4 md:max-w-[58%]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-extrabold tracking-[0.14em] text-leaf-200 uppercase">Within {radiusKm} km</p>
          <ModeSwitch active={mode} onDark />
        </div>
        <div>
          <h1 className="font-display text-[clamp(1.85rem,4.6vw,3rem)] leading-[1.04] font-extrabold tracking-[-0.045em]">
            {title}
          </h1>
          <p className="mt-2 flex items-center gap-2 text-sm font-medium text-white/85 sm:text-base">{status}</p>
        </div>
        {children}
      </div>
    </header>
  );
}

/** Photos drifting beside the headline, with steam rising off a hot dish. Decoration, so wider screens only. */
function HeroDishes({ dishes: [big, top, bottom], steam }: { dishes: [PhotoKey, PhotoKey, PhotoKey]; steam?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-[40%] md:block">
      <span className="animate-sway absolute top-1/2 right-[12%] block size-52 -translate-y-1/2 lg:size-60">
        <span className="relative block size-full overflow-hidden rounded-full shadow-[0_24px_50px_rgb(15_44_29/0.5)] ring-4 ring-white/15">
          <Dish name={big} sizes="240px" />
        </span>
        {steam && (
          <>
            <span className="animate-steam absolute -top-5 left-[38%] h-12 w-2.5 rounded-full bg-white/70 opacity-0 blur-[5px]" />
            <span className="animate-steam absolute -top-7 left-[52%] h-14 w-2.5 rounded-full bg-white/70 opacity-0 blur-[5px] [animation-delay:1.1s]" />
            <span className="animate-steam absolute -top-4 left-[64%] h-10 w-2 rounded-full bg-white/70 opacity-0 blur-[5px] [animation-delay:2.2s]" />
          </>
        )}
      </span>
      <span className="animate-float absolute top-5 right-[2%] block size-24 overflow-hidden rounded-full shadow-lg ring-4 ring-white/15 [animation-delay:1.2s] lg:size-28">
        <Dish name={top} sizes="112px" />
      </span>
      <span className="animate-float absolute bottom-5 left-[4%] block size-28 overflow-hidden rounded-full shadow-lg ring-4 ring-white/15 [animation-delay:2.4s] lg:size-32">
        <Dish name={bottom} sizes="128px" />
      </span>
    </div>
  );
}

/** Nothing can be ordered from Items yet, so the tab says so and lists nothing. */
function ItemsComingSoon({ radiusKm }: { radiusKm: number }) {
  return (
    <div className="min-w-0">
      <BrowseHero
        mode="items"
        radiusKm={radiusKm}
        title="Coming soon"
        dishes={['kirana', 'p-fruit-apple', 'p-veg-tomato']}
        status="Groceries and daily needs from shops near you will be here soon."
      >
        <ButtonLink
          href="/browse?mode=food"
          scroll={false}
          transitionTypes={['nav-filter']}
          variant="leaf-outline"
          size="lg"
          className="border-white bg-white text-leaf-700 hover:border-white hover:bg-white/90"
        >
          Browse food for now
        </ButtonLink>
      </BrowseHero>
    </div>
  );
}

function EmptyRadius({ radiusKm }: { radiusKm: number }) {
  return (
    <div className="animate-rise mx-auto max-w-md rounded-[30px] bg-[var(--surface)] p-8 text-center shadow-sm ring-1 ring-[var(--line)]">
      <h2 className="font-display text-xl font-extrabold tracking-[-0.035em]">Nothing within {radiusKm} km yet</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        Localty never shows shops that cannot reach you. Widen your radius from the header, or check back as more shops
        join your area.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        <SampleAreaButton />
        <ButtonLink href="/business/apply" variant="leaf-soft">
          Run a shop here? List it
        </ButtonLink>
      </div>
    </div>
  );
}

function BrowseSkeleton() {
  return (
    <div className="grid gap-7">
      <div className="grid gap-3">
        <div className="skeleton h-4 w-40 rounded-full" />
        <div className="skeleton h-9 w-72 rounded-full" />
      </div>
      <div className="skeleton h-12 w-56 rounded-full" />
      <div className="flex gap-2.5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="skeleton h-11 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton h-32 rounded-[26px]" />
        ))}
      </div>
    </div>
  );
}
