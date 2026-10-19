import { Suspense } from 'react';
import Link from 'next/link';
import type { ListingMode } from '@/lib/database.types';
import { readLocation } from '@/lib/data/location';
import { getNearbyCategories, getNearbyProducts, getNearbySellers, usingFixtures } from '@/lib/data/marketplace';
import { LocationGate } from '@/components/shell/location-gate';
import { ModeSwitch } from '@/components/marketplace/mode-switch';
import { DietFilter } from '@/components/marketplace/diet-filter';
import { CategoryRail } from '@/components/marketplace/category-rail';
import { ProductCard } from '@/components/marketplace/product-card';
import { ShopCard } from '@/components/marketplace/shop-card';
import { Reveal } from '@/components/motion/reveal';
import { Eyebrow, SectionTitle } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { SampleAreaButton } from '@/components/shell/sample-area-button';

type SearchParams = Promise<{ mode?: string; category?: string; diet?: string }>;

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const mode: ListingMode = params.mode === 'items' ? 'items' : 'food';
  const category = params.category;
  const diet = mode === 'food' && ['veg', 'non_veg', 'egg'].includes(params.diet ?? '') ? params.diet : undefined;

  return (
    <LocationGate>
      <Suspense key={`${mode}-${category ?? 'all'}-${diet ?? 'any'}`} fallback={<BrowseSkeleton />}>
        <BrowseContent mode={mode} category={category} diet={diet} />
      </Suspense>
    </LocationGate>
  );
}

async function BrowseContent({ mode, category, diet }: { mode: ListingMode; category?: string; diet?: string }) {
  const location = await readLocation();

  // The gate renders the picker; this only runs once a pin exists.
  if (!location) return <BrowseSkeleton />;

  const query = { lat: location.lat, lng: location.lng, radiusKm: location.radiusKm, mode };

  const [shops, allProducts, categories] = await Promise.all([
    getNearbySellers(query),
    getNearbyProducts({ ...query, category }),
    getNearbyCategories(query)
  ]);

  // Veg / non-veg is a property of each dish, so it narrows the menu, not the shops.
  const products = diet ? allProducts.filter((product) => product.veg_type === diet) : allProducts;

  const nothingNearby = !shops.length && !products.length;

  return (
    <div className="grid min-w-0 gap-7">
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
        <p className="mt-2 max-w-[52ch] text-[var(--text-muted)]">
          {shops.length} {shops.length === 1 ? 'shop' : 'shops'} can reach {location.label} right now —
          nothing here is further than your radius.
        </p>
      </header>

      <div className="animate-rise flex flex-wrap items-center justify-between gap-3 [animation-delay:60ms]">
        <ModeSwitch active={mode} />
        <Link href="/search" className="text-sm font-bold text-[var(--leaf-ink)] underline-offset-4 hover:underline">
          Looking for something specific? →
        </Link>
      </div>

      {mode === 'food' && (
        <div className="animate-rise [animation-delay:90ms]">
          <DietFilter active={diet} />
        </div>
      )}

      <div className="animate-rise min-w-0 [animation-delay:100ms]">
        <CategoryRail categories={categories} active={category} />
      </div>

      {nothingNearby ? (
        <EmptyRadius radiusKm={location.radiusKm} />
      ) : (
        <>
          {shops.length > 0 && (
            <section className="animate-rise grid gap-5 [animation-delay:140ms]">
              <SectionTitle>{mode === 'food' ? 'Kitchens near you' : 'Shops near you'}</SectionTitle>
              <div className="grid gap-4 sm:grid-cols-2">
                {shops.map((shop) => (
                  <ShopCard key={shop.id} shop={shop} />
                ))}
              </div>
            </section>
          )}

          {products.length === 0 && !diet && (
            <p className="animate-rise rounded-[18px] bg-[var(--tile)] px-4 py-3 text-sm text-[var(--text-muted)]">
              These shops have not listed any food for ordering yet. It will appear here as soon as they do.
            </p>
          )}

          {diet && products.length === 0 && (
            <p className="animate-rise rounded-[18px] bg-[var(--tile)] px-4 py-3 text-sm text-[var(--text-muted)]">
              No dishes match that filter nearby. Tap it again to see everything.
            </p>
          )}

          {products.length > 0 && (
            <section className="grid gap-5">
              <Reveal as="div">
                <SectionTitle>
                  {category
                    ? 'Matching items'
                    : mode === 'food'
                      ? 'On the menu today'
                      : 'Everyday essentials'}
                </SectionTitle>
              </Reveal>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {products.map((product, index) => (
                  <Reveal key={product.id} delay={(index % 4) * 55}>
                    <ProductCard product={product} />
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

function EmptyRadius({ radiusKm }: { radiusKm: number }) {
  return (
    <div className="animate-rise mx-auto max-w-md rounded-[30px] bg-[var(--surface)] p-8 text-center shadow-sm ring-1 ring-[var(--line)]">
      <h2 className="font-display text-xl font-extrabold tracking-[-0.035em]">
        Nothing within {radiusKm} km yet
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        ReadyUs never shows shops that cannot reach you. Widen your radius from
        the header, or check back as more shops join your area.
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
