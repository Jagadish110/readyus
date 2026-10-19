import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { requireShop } from '@/lib/business/shop';
import { loose, PRODUCT_COLUMNS, STATUS_LABEL, STATUS_TONE, type ProductRow } from '@/lib/business/db';
import { Badge, VegMark } from '@/components/ui/badge';
import { Card, Eyebrow } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { StockToggle } from '@/components/business/stock-toggle';
import { StarIcon } from '@/components/shell/icons';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Your products' };
export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const { supabase, shop } = await requireShop();

  const { data } = await loose(supabase)
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('seller_id', shop.id)
    .order('created_at', { ascending: false });
  const products = (data as ProductRow[] | null) ?? [];

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
        <ul className="grid gap-4 sm:grid-cols-2">
          {products.map((product, index) => {
            const inStock = product.available && product.stock > 0;
            const rating = Number(product.rating);
            return (
              <li
                key={product.id}
                className="animate-rise overflow-hidden rounded-[26px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]"
                style={{ animationDelay: Math.min(index, 5) * 50 + 'ms' }}
              >
                <Link href={`/business/products/${product.id}`} className="group block">
                  <div className="tile relative aspect-[16/10] w-full overflow-hidden bg-[var(--tile)]">
                    {product.images[0] ? (
                      <Image
                        src={product.images[0]}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 92vw, 380px"
                        className={cn(
                          'object-cover transition-transform duration-500 group-hover:scale-[1.05]',
                          !inStock && 'grayscale'
                        )}
                      />
                    ) : (
                      <span className="grid size-full place-items-center font-display text-4xl font-extrabold text-[var(--leaf-ink)]">
                        {product.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[0.74rem] font-extrabold text-ink-900 shadow-sm">
                      <StarIcon className="size-3.5 text-saffron-500" />
                      {rating > 0 ? rating.toFixed(1) : 'New'}
                      {product.rating_count > 0 && (
                        <span className="font-semibold text-ink-500">({product.rating_count})</span>
                      )}
                    </span>
                  </div>
                  <div className="grid gap-1 px-4 pt-3.5">
                    <div className="flex items-start gap-2">
                      <VegMark type={product.veg_type} />
                      <h2 className="line-clamp-2 flex-1 font-display text-[1.02rem] leading-tight font-extrabold tracking-[-0.025em]">
                        {product.name}
                      </h2>
                    </div>
                    <p className="font-display text-lg font-extrabold text-brand-600">
                      ₹{Number(product.price).toLocaleString('en-IN')}
                      {product.unit && (
                        <span className="text-xs font-semibold text-[var(--text-muted)]"> / {product.unit}</span>
                      )}
                    </p>
                  </div>
                </Link>
                <div className="flex items-center justify-between gap-2 px-4 pt-2 pb-4">
                  <StockToggle productId={product.id} inStock={inStock} />
                  {product.approval_status !== 'approved' && (
                    <Badge tone={STATUS_TONE[product.approval_status]}>
                      {STATUS_LABEL[product.approval_status]}
                    </Badge>
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
