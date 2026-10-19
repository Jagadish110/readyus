import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readLocation } from '@/lib/data/location';
import { getNearbyProducts, getSellerById } from '@/lib/data/marketplace';
import { LocationGate } from '@/components/shell/location-gate';
import { ProductCard } from '@/components/marketplace/product-card';
import { Badge } from '@/components/ui/badge';
import { SectionTitle } from '@/components/ui/card';
import { ShopArt } from '@/components/marketplace/shop-art';
import { StarIcon } from '@/components/shell/icons';
import { deliveryMinutes, formatRupees } from '@/lib/utils';

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

  const products = await getNearbyProducts({ ...query, sellerId: id, limit: 100 });

  // Group the menu by category so a long list stays readable.
  const sections = new Map<string, typeof products>();
  for (const product of products) {
    const key = product.category_key || 'Other';
    sections.set(key, [...(sections.get(key) ?? []), product]);
  }

  return (
    <div className="grid gap-8">
      <header className="animate-rise overflow-hidden rounded-[30px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]">
        <div className="tile relative h-48 bg-[var(--tile)] sm:h-64">
          <ShopArt
            shop={shop}
            priority
            sizes="(max-width: 768px) 100vw, 960px"
            className={shop.business_open ? '' : 'grayscale'}
          />
          <div aria-hidden className="absolute inset-0 bg-linear-to-t from-ink-900/85 via-ink-900/20 to-transparent" />
          <div className="absolute inset-x-5 bottom-4 sm:inset-x-7 sm:bottom-5">
            <p className="text-[0.72rem] font-bold tracking-[0.14em] text-white/85 uppercase">{shop.category}</p>
            <h1 className="mt-1 font-display text-[clamp(1.7rem,4.5vw,2.6rem)] leading-tight font-extrabold tracking-[-0.04em] text-white">
              {shop.shop_name}
            </h1>
          </div>
          <span className="absolute top-4 right-4 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-sm font-extrabold text-ink-900 shadow-sm">
            <StarIcon className="size-4 text-saffron-500" />
            {shop.rating > 0 ? shop.rating.toFixed(1) : 'New'}
            {shop.rating_count > 0 && (
              <span className="text-xs font-semibold text-ink-500">({shop.rating_count})</span>
            )}
          </span>
          <span
            className={
              'absolute top-4 left-4 rounded-full px-3 py-1.5 text-xs font-extrabold ' +
              (shop.business_open ? 'bg-leaf-600 text-white' : 'bg-ink-900/85 text-white')
            }
          >
            {shop.business_open ? 'Open now' : 'Closed right now'}
          </span>
        </div>

        <div className="grid gap-4 p-5 sm:p-7">
          <p className="text-sm text-[var(--text-muted)]">
            {shop.address}, {shop.city}
          </p>
          {shop.description && (
            <p className="max-w-[60ch] text-sm leading-relaxed text-[var(--text-muted)]">{shop.description}</p>
          )}

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[20px] bg-[var(--line)] text-center sm:grid-cols-4">
            {[
              ['Distance', shop.distance_km.toFixed(1) + ' km'],
              ['Delivery in', '~' + deliveryMinutes(shop.distance_km, shop.eta_minutes) + ' min'],
              ['Minimum', shop.min_order_amount ? formatRupees(shop.min_order_amount) : 'None'],
              ['Delivery fee', shop.delivery_fee ? formatRupees(shop.delivery_fee) : 'Free']
            ].map(([label, value]) => (
              <div key={label} className="bg-[var(--surface)] px-3 py-3.5">
                <dt className="text-[0.66rem] font-bold tracking-[0.14em] text-[var(--text-muted)] uppercase">{label}</dt>
                <dd className="mt-1 font-display text-lg font-extrabold tracking-[-0.03em]">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-2">
            {shop.cod_available && <Badge tone="leaf-soft">Cash on delivery</Badge>}
            {shop.free_delivery_above > 0 && (
              <Badge tone="leaf-soft">Free delivery over {formatRupees(shop.free_delivery_above)}</Badge>
            )}
          </div>
        </div>
      </header>

      {products.length === 0 ? (
        <p className="rounded-[26px] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)] ring-1 ring-[var(--line)]">
          This shop has not listed anything yet.
        </p>
      ) : (
        [...sections.entries()].map(([key, items]) => (
          <section key={key} className="grid gap-4">
            <SectionTitle className="capitalize">{key}</SectionTitle>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        ))
      )}

      <p className="text-center text-sm text-[var(--text-muted)]">
        <Link href="/browse" className="font-semibold hover:text-brand-600">
          Back to browse
        </Link>
      </p>
    </div>
  );
}
