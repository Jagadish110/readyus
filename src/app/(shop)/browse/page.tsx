import Link from 'next/link';
import type { ListingMode } from '@/lib/database.types';
import { readLocation } from '@/lib/data/location';
import { getNearbyCategories, getNearbyProducts, getNearbySellers, usingFixtures } from '@/lib/data/marketplace';
import { LocationGate } from '@/components/shell/location-gate';
import { ModeSwitch } from '@/components/marketplace/mode-switch';
import { DietFilter } from '@/components/marketplace/diet-filter';
import { CategoryRail } from '@/components/marketplace/category-rail';
import { ProductCard } from '@/components/marketplace/product-card';
import { ShopStrip } from '@/components/marketplace/shop-strip';
import { foodCategoryRail } from '@/lib/data/food-categories';
import { Reveal } from '@/components/motion/reveal';
import { Eyebrow, SectionTitle } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { SampleAreaButton } from '@/components/shell/sample-area-button';
import { SearchIcon } from '@/components/shell/icons';

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

  if (mode === 'items') return <ItemsComingSoon radiusKm={location.radiusKm} label={location.label} />;

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

  return (
    <div className="grid min-w-0 gap-5 sm:gap-7">
      {usingFixtures() && (
        <p className="animate-rise rounded-[18px] bg-warning/12 px-4 py-2.5 text-sm font-medium text-[var(--text)] ring-1 ring-warning/35">
          Showing sample data. Connect a Supabase project to load real shops.
        </p>
      )}

      {/* Everything down to the first row of shops is above the fold, so it
          animates with CSS instead of waiting for the reveal observer. */}
      <header className="animate-rise">
        <Eyebrow>Within {location.radiusKm} km of you</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.5rem,3.6vw,2.4rem)] leading-[1.04] font-extrabold tracking-[-0.045em]">
          {mode === 'food' ? 'Fresh from kitchens nearby' : 'Everyday shopping nearby'}
        </h1>
        <p className="mt-1.5 max-w-[52ch] text-[var(--text-muted)]">
          {shops.length} {shops.length === 1 ? 'shop' : 'shops'} can reach {location.label.split(',')[0]} right now.
        </p>
      </header>

      <div className="animate-rise flex flex-col gap-3 [animation-delay:60ms] sm:flex-row-reverse sm:items-center sm:justify-between">
        {/* A real-looking search box: on a phone it is the quickest way to a specific dish. */}
        <Link
          href="/search"
          transitionTypes={['nav-forward']}
          className="flex h-12 items-center gap-3 rounded-full border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-[0.95rem] text-[var(--text-muted)] shadow-xs transition-[border-color,transform] hover:border-leaf-400 active:scale-[0.98] sm:w-80"
        >
          <SearchIcon className="size-5 shrink-0" />
          Search biryani, dosa, shops…
        </Link>
        <ModeSwitch active={mode} />
      </div>

      <div className="animate-rise flex min-w-0 flex-col gap-3 [animation-delay:90ms] lg:flex-row lg:items-center">
        <DietFilter active={diet} />
        <span aria-hidden className="hidden h-6 w-px shrink-0 bg-[var(--line)] lg:block" />
        <div className="min-w-0 flex-1">
          <CategoryRail categories={foodCategoryRail(categories)} active={category} />
        </div>
      </div>

      {nothingNearby ? (
        <EmptyRadius radiusKm={location.radiusKm} />
      ) : (
        <>
          {!focused && shops.length > 0 && (
            <section className="animate-rise grid gap-5 [animation-delay:140ms]">
              <div className="flex items-baseline justify-between gap-3">
                <SectionTitle>{mode === 'food' ? 'Kitchens near you' : 'Shops near you'}</SectionTitle>
                <span className="shrink-0 text-xs font-bold text-[var(--text-muted)]">
                  {shops.length} {shops.length === 1 ? 'kitchen' : 'kitchens'}
                </span>
              </div>
              <ShopStrip shops={shops} />
            </section>
          )}

          {products.length === 0 && !focused && (
            <p className="animate-rise rounded-[18px] bg-[var(--tile)] px-4 py-3 text-sm text-[var(--text-muted)]">
              These shops have not listed any food for ordering yet. It will appear here as soon as they do.
            </p>
          )}

          {focused && products.length === 0 && (
            <p className="animate-rise rounded-[18px] bg-[var(--tile)] px-4 py-3 text-sm text-[var(--text-muted)]">
              Nothing matches that nearby. Tap All to see everything.
            </p>
          )}

          {products.length > 0 && (
            <section className="grid gap-5">
              <Reveal as="div">
                <SectionTitle>
                  {category ? 'Matching items' : mode === 'food' ? 'On the menu today' : 'Everyday essentials'}
                </SectionTitle>
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

const ITEM_CATEGORIES = ['Staples', 'Vegetables', 'Fruits', 'Dairy & Eggs', 'Snacks', 'Household'];

function ItemsComingSoon({ radiusKm, label }: { radiusKm: number; label: string }) {
  return (
    <div className="grid min-w-0 gap-7">
      <header className="animate-rise">
        <Eyebrow>Within {radiusKm} km of you</Eyebrow>
        <h1 className="mt-2 font-display text-[clamp(1.5rem,3.6vw,2.4rem)] leading-[1.04] font-extrabold tracking-[-0.045em]">
          Everyday shopping nearby
        </h1>
        <p className="mt-2 max-w-[52ch] text-[var(--text-muted)]">
          Groceries and daily needs from shops that can reach {label} are coming soon.
        </p>
      </header>

      <div className="animate-rise justify-self-start">
        <ModeSwitch active="items" />
      </div>

      <div
        aria-label="Item categories, available soon"
        className="no-scrollbar animate-rise -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {ITEM_CATEGORIES.map((name) => (
          <span
            key={name}
            className="inline-flex shrink-0 items-center rounded-full border border-[var(--line)] bg-[var(--surface)] px-5 py-2.5 text-[0.92rem] font-bold whitespace-nowrap text-[var(--text-muted)] opacity-70"
          >
            {name}
          </span>
        ))}
      </div>

      <div className="animate-rise mx-auto max-w-md rounded-[30px] bg-[var(--surface)] p-8 text-center shadow-sm ring-1 ring-[var(--line)]">
        <span className="inline-flex rounded-full bg-[var(--leaf-soft)] px-3.5 py-1.5 text-eyebrow text-[var(--leaf-ink)] uppercase">
          Coming soon
        </span>
        <h2 className="mt-4 font-display text-xl font-extrabold tracking-[-0.035em]">Everyday items are on the way</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          Rice, dal, vegetables and more from the kirana down your road will be orderable here soon. For now, food from
          nearby kitchens is live.
        </p>
        <div className="mt-5 flex justify-center">
          <ButtonLink href="/browse?mode=food" variant="leaf">
            Browse food
          </ButtonLink>
        </div>
      </div>
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
