import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { requireShop } from '@/lib/business/shop';
import { STATUS_LABEL, STATUS_TONE, type ProductRow } from '@/lib/business/db';
import { serverApi } from '@/lib/api/server';
import { Badge, VegMark } from '@/components/ui/badge';
import { Card, Eyebrow } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { StockToggle } from '@/components/business/stock-toggle';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Your products' };
export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  await requireShop();

  const result = await serverApi<{ products: ProductRow[] }>('/v1/seller/products');
  // An outage must not look like an empty menu.
  if (!result.ok) throw new Error('We could not load your products right now. Please try again.');
  const products = result.data.products;

  return (
    <div className="animate-rise grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Menu</Eyebrow>
          <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
            Your products
          </h1>
        </div>
        <ButtonLink href="/business/products/new" variant="leaf" size="sm">
          Add product
        </ButtonLink>
      </div>

      {products.length === 0 ? (
        <Card className="grid justify-items-center gap-2 p-8 text-center">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">No products yet</h2>
          <p className="max-w-sm text-sm text-[var(--text-muted)]">
            Add your first item. Customers nearby can order it as soon as you save.
          </p>
          <ButtonLink href="/business/products/new" variant="leaf" size="sm" className="mt-2">
            Add your first product
          </ButtonLink>
        </Card>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {products.map((product) => {
            const inStock = product.available && product.stock > 0;
            const items = product.listing_mode === 'items';
            return (
              <li
                key={product.id}
                className="flex items-center gap-3 rounded-[22px] bg-[var(--surface)] p-3 shadow-sm ring-1 ring-[var(--line)]"
              >
                <Link
                  href={`/business/products/${product.id}`}
                  className="group flex min-w-0 flex-1 items-center gap-3 rounded-[16px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf-500"
                >
                  <span className="tile relative size-16 shrink-0 overflow-hidden rounded-[16px] bg-[var(--tile)]">
                    {product.images[0] ? (
                      <Image
                        src={product.images[0]}
                        alt=""
                        fill
                        sizes="64px"
                        className={cn('object-cover', !inStock && 'grayscale')}
                      />
                    ) : (
                      <span className="grid size-full place-items-center font-display text-xl font-extrabold text-[var(--leaf-ink)]">
                        {product.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex items-start gap-1.5">
                      <VegMark type={product.veg_type} />
                      <span className="line-clamp-2 font-display text-[0.98rem] leading-tight font-extrabold tracking-[-0.025em]">
                        {product.name}
                      </span>
                    </span>
                    <span className="font-display font-extrabold text-brand-600">
                      ₹{Number(product.price).toLocaleString('en-IN')}
                      {product.unit && (
                        <span className="text-xs font-semibold text-[var(--text-muted)]"> / {product.unit}</span>
                      )}
                    </span>
                    {product.approval_status !== 'approved' && (
                      <span>
                        <Badge tone={STATUS_TONE[product.approval_status]}>{STATUS_LABEL[product.approval_status]}</Badge>
                      </span>
                    )}
                  </span>
                </Link>
                <div className="shrink-0">
                  {items ? (
                    <span
                      className={cn(
                        'inline-flex h-9 items-center rounded-full px-3 text-xs font-extrabold ring-1 ring-[var(--line)]',
                        product.stock === 0
                          ? 'bg-[var(--tile)] text-[var(--text-muted)]'
                          : product.stock <= 5
                            ? 'bg-warning/12 text-[var(--text)]'
                            : 'bg-[var(--leaf-soft)] text-[var(--leaf-ink)]'
                      )}
                    >
                      {product.stock === 0 ? 'Sold out' : product.stock <= 5 ? product.stock + ' left' : product.stock + ' in stock'}
                    </span>
                  ) : (
                    <StockToggle productId={product.id} inStock={inStock} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
