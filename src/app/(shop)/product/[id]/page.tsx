import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readLocation } from '@/lib/data/location';
import { getNearbyProducts, getProductById, getSellerById } from '@/lib/data/marketplace';
import { LocationGate } from '@/components/shell/location-gate';
import { ProductCard } from '@/components/marketplace/product-card';
import { ProductBuy } from '@/components/marketplace/add-to-cart-panel';
import { Dish } from '@/components/art/dish-photo';
import { dishForProduct } from '@/components/art/dish-map';
import { Badge, VegMark } from '@/components/ui/badge';
import { SectionTitle } from '@/components/ui/card';
import { ClockIcon, StarIcon } from '@/components/shell/icons';
import { deliveryMinutes, discountPercent, formatRupees } from '@/lib/utils';
import { describeDelivery } from '@/lib/shop-terms';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <LocationGate>
      <ProductDetail id={id} />
    </LocationGate>
  );
}

async function ProductDetail({ id }: { id: string }) {
  const location = await readLocation();
  if (!location) return null;

  const query = { lat: location.lat, lng: location.lng, radiusKm: location.radiusKm };
  const product = await getProductById(id, query);
  if (!product) notFound();

  const [shop, related] = await Promise.all([
    getSellerById(product.seller_id, query),
    getNearbyProducts({ ...query, sellerId: product.seller_id, limit: 8 })
  ]);

  const off = discountPercent(product.price, product.mrp);
  const others = related.filter((item) => item.id !== product.id).slice(0, 4);

  return (
    <div className="grid gap-8">
      {/* Breadcrumbs lead back up, so the page slides the way it came. */}
      <nav className="-my-3 flex items-center text-sm text-[var(--text-muted)]">
        <Link href="/browse" transitionTypes={['nav-back']} className="inline-flex h-11 items-center hover:text-brand-600">
          Browse
        </Link>
        <span aria-hidden className="px-2">/</span>
        <Link
          href={`/shop/${product.seller_id}`}
          transitionTypes={['nav-back']}
          className="inline-flex h-11 min-w-0 items-center truncate hover:text-brand-600"
        >
          {product.seller_name}
        </Link>
      </nav>

      <div className="grid gap-7 md:grid-cols-2">
        <div className="tile animate-rise relative aspect-[4/3] overflow-hidden rounded-[30px] bg-[var(--tile)] shadow-sm ring-1 ring-[var(--line)] md:aspect-square">
          {product.images?.[0] ? (
            <Image
              src={product.images[0]}
              alt={product.name}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 480px"
              className="object-cover"
            />
          ) : (
            <Dish name={dishForProduct(product)} priority sizes="(max-width: 768px) 100vw, 480px" />
          )}
          {off && (
            <span className="absolute top-4 left-4">
              <Badge tone="brand">{off}% off</Badge>
            </span>
          )}
        </div>

        <div className="grid content-start gap-4">
          <div className="flex items-start gap-2">
            <VegMark type={product.veg_type} />
            <h1 className="font-display text-[clamp(1.7rem,4vw,2.4rem)] leading-tight font-extrabold tracking-[-0.04em]">
              {product.name}
            </h1>
          </div>

          <Link
            href={`/shop/${product.seller_id}`}
            className="inline-flex w-fit items-center gap-2 rounded-full border bg-[var(--surface)] py-1.5 pr-4 pl-1.5 text-sm font-bold shadow-sm transition-colors hover:border-brand-200 hover:text-brand-700"
          >
            <span className="grid size-7 place-items-center rounded-full bg-brand-50 font-display text-xs text-brand-600">
              {product.seller_name.slice(0, 1)}
            </span>
            {product.seller_name}
          </Link>

          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1 rounded-md bg-success-soft px-2 py-1 text-success">
              <StarIcon className="size-3.5" />
              {product.rating.toFixed(1)} ({product.rating_count})
            </span>
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-4" />
              ~{deliveryMinutes(product.distance_km, product.eta_minutes)} min
            </span>
            <span>{product.distance_km.toFixed(1)} km away</span>
          </div>

          {product.description && (
            <p className="max-w-[52ch] leading-relaxed text-[var(--text-muted)]">{product.description}</p>
          )}

          {product.combo_items?.length ? (
            <div className="rounded-[18px] bg-[var(--tile)] p-4">
              <p className="text-xs font-extrabold tracking-[0.08em] text-[var(--leaf-ink)] uppercase">In this combo</p>
              <ul className="mt-2 grid gap-1.5">
                {product.combo_items.map((item, index) => (
                  <li key={`${item.name}-${index}`} className="flex gap-2 font-semibold">
                    <span className="w-8 shrink-0 text-[var(--text-muted)] tabular-nums">{item.qty} ×</span>
                    {item.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex items-end gap-3 pt-1">
            {product.variants?.length ? (
              <span className="pb-1 text-sm font-semibold text-[var(--text-muted)]">from</span>
            ) : null}
            <span className="font-display text-[2rem] leading-none font-extrabold tracking-[-0.04em]">
              {formatRupees(product.price)}
            </span>
            {!product.variants?.length && product.mrp && product.mrp > product.price && (
              <span className="pb-1 text-[var(--text-muted)] line-through">{formatRupees(product.mrp)}</span>
            )}
            {!product.variants?.length && product.unit && (
              <span className="pb-1 text-sm text-[var(--text-muted)]">/ {product.unit}</span>
            )}
          </div>

          {!product.business_open && (
            <p className="rounded-lg border-l-[3px] border-warning bg-warning-soft px-3.5 py-2.5 text-sm font-medium text-warning">
              {product.seller_name} is closed right now. You can still add this and order when they reopen.
            </p>
          )}

          <ProductBuy product={product} />

          {shop && (
            <dl className="mt-2 grid grid-cols-2 gap-3 border-t pt-4 text-sm">
              <Fact
                label="Minimum order"
                value={Number(shop.min_order_amount) > 0 ? formatRupees(Number(shop.min_order_amount)) : 'None'}
              />
              <Fact label="Delivery" value={describeDelivery(shop)} />
              {/* A shop keeps at least one way to pay on, so without cash it must take online payment. */}
              <Fact label="Payment" value={shop.cod_available ? 'Online or cash on delivery' : 'Online only'} />
              <Fact label="Availability" value={product.stock > 0 ? "Available" : "Out of stock"} />
            </dl>
          )}
        </div>
      </div>

      {others.length > 0 && (
        <section className="grid gap-4">
          <SectionTitle>More from {product.seller_name}</SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {others.map((item) => (
              <ProductCard key={item.id} product={item} showShop={false} layout="row" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-[var(--text-muted)]">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
