import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readLocation } from '@/lib/data/location';
import { getFssaiNumber, getNearbyProducts, getSellerById } from '@/lib/data/marketplace';
import { LocationGate } from '@/components/shell/location-gate';
import { ProductCard } from '@/components/marketplace/product-card';
import { SectionTitle } from '@/components/ui/card';
import { ShopArt } from '@/components/marketplace/shop-art';
import { FavouriteButton } from '@/components/shop/favourite-button';
import { ClockIcon, PinIcon, StarIcon } from '@/components/shell/icons';
import { deliveryMinutes, formatDistance, formatRupees, opensAt } from '@/lib/utils';
import { FOOD_CATEGORIES } from '@/lib/data/food-categories';
import { describeDelivery } from '@/lib/shop-terms';

/** The menu heading for a category key: the name customers know it by, not the database key. */
function sectionName(key: string) {
  const known = FOOD_CATEGORIES.find((category) => category.key === key);
  return known ? known.name : key.charAt(0).toUpperCase() + key.slice(1).replace(/[_-]/g, ' ');
}

export default async function ShopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <LocationGate>
      <ShopDetail id={id} />
    </LocationGate>
  );
}

async function ShopDetail({ id }: { id: string }) {
  const location = await readLocation();
  if (!location) return null;

  const query = { lat: location.lat, lng: location.lng, radiusKm: location.radiusKm };
  const shop = await getSellerById(id, query);
  if (!shop) notFound();

  const [products, fssai] = await Promise.all([getNearbyProducts({ ...query, sellerId: id, limit: 100 }), getFssaiNumber(id)]);

  // Group the menu by category so a long list stays readable.
  const sections = new Map<string, typeof products>();
  for (const product of products) {
    const key = product.category_key || 'Other';
    sections.set(key, [...(sections.get(key) ?? []), product]);
  }

  return (
    <div className="grid gap-8">
      <header className="animate-rise overflow-hidden rounded-[30px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]">
        <div className="tile relative h-24 bg-[var(--tile)] sm:h-32">
          <ShopArt
            shop={shop}
            priority
            sizes="(max-width: 768px) 100vw, 960px"
            className={shop.business_open ? 'scale-110 blur-[2px]' : 'scale-110 blur-[2px] grayscale'}
          />
          <div aria-hidden className="absolute inset-0 bg-linear-to-b from-ink-900/30 to-ink-900/55" />
          <span
            className={
              'absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold ' +
              (shop.business_open ? 'bg-leaf-600 text-white' : 'bg-ink-900/85 text-white')
            }
          >
            <span aria-hidden className={'size-2 rounded-full ' + (shop.business_open ? 'bg-white' : 'bg-ink-400')} />
            {shop.business_open ? 'Open now' : opensAt(shop.open_time, shop.close_time) ? `Closed · ${opensAt(shop.open_time, shop.close_time)}` : 'Closed right now'}
          </span>
        </div>

        <div className="px-5 pb-6 sm:px-7">
          <div className="-mt-10 flex items-end justify-between gap-3">
            <span className="tile relative block size-20 shrink-0 overflow-hidden rounded-[22px] bg-[var(--tile)] shadow-md ring-4 ring-[var(--surface)] sm:size-24">
              <ShopArt shop={shop} sizes="96px" />
            </span>
            <span className="mb-1 flex items-center gap-2">
              <FavouriteButton shopId={shop.id} />
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tile)] px-3.5 py-2 text-sm font-extrabold ring-1 ring-[var(--line)]">
                <StarIcon className="size-4 text-saffron-500" />
                {shop.rating > 0 ? shop.rating.toFixed(1) : 'New'}
                {shop.rating_count > 0 && (
                  <span className="text-xs font-semibold text-[var(--text-muted)]">({shop.rating_count})</span>
                )}
              </span>
            </span>
          </div>

          <p className="mt-4 text-[0.72rem] font-bold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">
            {shop.category}
          </p>
          <h1 className="mt-1 font-display text-[clamp(1.8rem,4.5vw,2.5rem)] leading-tight font-extrabold tracking-[-0.045em]">
            {shop.shop_name}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
            <PinIcon className="size-4 shrink-0" />
            {shop.address}, {shop.city}
          </p>
          {shop.description && (
            <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-[var(--text-muted)]">{shop.description}</p>
          )}

          <ul className="no-scrollbar -mx-5 mt-5 flex gap-2.5 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
            {[
              [<PinIcon key="d" className="size-4" />, formatDistance(shop.distance_km) + ' away'],
              [<ClockIcon key="t" className="size-4" />, '~' + deliveryMinutes(shop.distance_km, shop.eta_minutes) + ' min'],
              // Postgres numerics arrive as strings, so "0" must not read as a minimum.
              [null, Number(shop.min_order_amount) > 0 ? 'Min ' + formatRupees(Number(shop.min_order_amount)) : 'No minimum'],
              [null, describeDelivery(shop)]
            ].map(([icon, label], index) => (
              <li
                key={index}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--tile)] px-4 py-2 text-sm font-bold ring-1 ring-[var(--line)]"
              >
                {icon}
                {label}
              </li>
            ))}
            {/* A shop always keeps at least one way to pay on, so without cash it must take online payment. */}
            <li className="inline-flex shrink-0 items-center rounded-full bg-[var(--leaf-soft)] px-4 py-2 text-sm font-bold text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
              {shop.cod_available ? 'Cash on delivery' : 'Online payment'}
            </li>
          </ul>
          {fssai && (
            <p className="mt-4 text-xs font-semibold text-[var(--text-muted)]">
              FSSAI Lic. No. <span className="tabular-nums">{fssai}</span>
            </p>
          )}
        </div>
      </header>

      {products.length === 0 ? (
        <p className="rounded-[26px] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)] ring-1 ring-[var(--line)]">
          This shop has not listed anything yet.
        </p>
      ) : (
        <>
          {/* A long menu gets a row of jump links, so nobody scrolls past twenty dishes to find dessert. */}
          {sections.size > 1 && (
            <nav
              aria-label="Menu sections"
              className="no-scrollbar sticky top-[72px] z-20 -mx-4 -my-4 flex gap-2 overflow-x-auto bg-[var(--page)]/90 px-4 py-2.5 backdrop-blur sm:mx-0 sm:px-0"
            >
              {[...sections.entries()].map(([key, items]) => (
                <a
                  key={key}
                  href={`#menu-${key}`}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-bold whitespace-nowrap text-[var(--text-muted)] hover:border-leaf-400 hover:text-[var(--leaf-ink)]"
                >
                  {sectionName(key)}
                  <span className="text-xs font-semibold text-ink-400">{items.length}</span>
                </a>
              ))}
            </nav>
          )}

          {[...sections.entries()].map(([key, items]) => (
            <section key={key} id={`menu-${key}`} className="grid scroll-mt-36 gap-3">
              <SectionTitle>
                {sectionName(key)} <span className="text-base font-bold text-[var(--text-muted)]">({items.length})</span>
              </SectionTitle>
              <div className="grid gap-3 lg:grid-cols-2">
                {items.map((product) => (
                  <ProductCard key={product.id} product={product} showShop={false} layout="row" />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      <p className="text-center text-sm text-[var(--text-muted)]">
        <Link
          href="/browse"
          transitionTypes={['nav-back']}
          className="inline-flex h-11 items-center px-2 font-semibold hover:text-brand-600"
        >
          Back to browse
        </Link>
      </p>
    </div>
  );
}
