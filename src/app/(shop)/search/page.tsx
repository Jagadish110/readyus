import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { readLocation } from '@/lib/data/location';
import { getNearbyProducts, getNearbySellers } from '@/lib/data/marketplace';
import { LocationGate } from '@/components/shell/location-gate';
import { ProductCard } from '@/components/marketplace/product-card';
import { ShopCard } from '@/components/marketplace/shop-card';
import { Reveal } from '@/components/motion/reveal';
import { Eyebrow, SectionTitle } from '@/components/ui/card';
import { SearchIcon } from '@/components/shell/icons';

export const metadata: Metadata = { title: 'Search' };

type SearchParams = Promise<{ q?: string }>;

const SUGGESTIONS = ['Biryani', 'Dosa', 'Chai', 'Kebab', 'Rice', 'Vegetables', 'Sweets', 'Bakery'];

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const { q } = await searchParams;
  // Capped so a pasted paragraph cannot become a database query.
  const term = (q ?? '').trim().slice(0, 80);

  return (
    <LocationGate>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-7">
        <header className="animate-rise">
          <Eyebrow>Search</Eyebrow>
          <h1 className="mt-2 font-display text-[clamp(1.5rem,3.6vw,2.4rem)] leading-[1.04] font-extrabold tracking-[-0.045em]">
            What are you craving?
          </h1>
        </header>

        {/* A plain GET form: works before hydration and keeps results linkable. */}
        <form
          action="/search"
          role="search"
          className="animate-rise flex min-w-0 items-center gap-2 rounded-full border-[1.5px] border-[var(--line)] bg-[var(--surface)] p-1.5 pl-5 shadow-sm transition-colors focus-within:border-leaf-500 focus-within:ring-4 focus-within:ring-leaf-500/20 [animation-delay:60ms]"
        >
          <SearchIcon className="size-5 shrink-0 text-[var(--text-muted)]" />
          <input
            type="search"
            name="q"
            defaultValue={term}
            maxLength={80}
            autoFocus={!term}
            autoComplete="off"
            placeholder="Search biryani, dosa, rice, a shop name…"
            aria-label="Search shops and dishes"
            className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-400"
          />
          <button
            type="submit"
            className="h-11 shrink-0 rounded-full bg-leaf-600 px-6 text-sm font-bold text-white shadow-[0_8px_20px_rgb(36_101_64/0.3)] transition-[transform,background-color] hover:bg-leaf-700 active:scale-95"
          >
            Search
          </button>
        </form>

        {term ? (
          <Suspense key={term} fallback={<ResultsSkeleton />}>
            <Results term={term} />
          </Suspense>
        ) : (
          <section className="animate-rise [animation-delay:120ms]">
            <p className="text-sm font-bold text-[var(--text-muted)]">Popular near you</p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {SUGGESTIONS.map((word) => (
                <Link
                  key={word}
                  href={'/search?q=' + encodeURIComponent(word)}
                  className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-5 py-2.5 text-[0.92rem] font-bold text-[var(--text-muted)] transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)]"
                >
                  {word}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </LocationGate>
  );
}

async function Results({ term }: { term: string }) {
  const location = await readLocation();
  if (!location) return <ResultsSkeleton />;

  const query = { lat: location.lat, lng: location.lng, radiusKm: location.radiusKm, search: term };
  const [shops, products] = await Promise.all([
    getNearbySellers({ ...query, limit: 12 }),
    getNearbyProducts({ ...query, limit: 40 })
  ]);

  if (!shops.length && !products.length) {
    return (
      <div className="animate-rise mx-auto max-w-md rounded-[30px] bg-[var(--surface)] p-8 text-center shadow-sm ring-1 ring-[var(--line)]">
        <h2 className="font-display text-xl font-extrabold tracking-[-0.035em]">
          Nothing for &ldquo;{term}&rdquo; within {location.radiusKm} km
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          Check the spelling, try a simpler word like &ldquo;biryani&rdquo;, or widen your radius from the header.
        </p>
        <Link
          href="/browse"
          className="mt-5 inline-flex h-12 items-center rounded-full bg-leaf-600 px-6 text-[0.95rem] font-bold text-white shadow-[0_10px_26px_rgb(36_101_64/0.3)] transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-leaf-700"
        >
          Browse everything nearby
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <p className="animate-rise text-sm font-semibold text-[var(--text-muted)]">
        {products.length} {products.length === 1 ? 'dish' : 'dishes'} and {shops.length}{' '}
        {shops.length === 1 ? 'shop' : 'shops'} for &ldquo;{term}&rdquo; near {location.label}
      </p>

      {shops.length > 0 && (
        <section className="animate-rise grid gap-5">
          <SectionTitle>Shops</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            {shops.map((shop) => (
              <ShopCard key={shop.id} shop={shop} />
            ))}
          </div>
        </section>
      )}

      {products.length > 0 && (
        <section className="grid gap-5">
          <Reveal>
            <SectionTitle>Dishes and items</SectionTitle>
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
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="skeleton h-32 rounded-[26px]" />
      ))}
    </div>
  );
}
