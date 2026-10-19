import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireShop } from '@/lib/business/shop';
import { loadCategories } from '@/lib/business/categories';
import { loose, PRODUCT_COLUMNS, STATUS_LABEL, STATUS_TONE, type ProductRow } from '@/lib/business/db';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/card';
import { ProductForm } from '@/components/business/product-form';

export const metadata: Metadata = { title: 'Edit product' };
export const dynamic = 'force-dynamic';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, shop } = await requireShop();

  // Scoped to this shop, so another seller's id is simply "not found".
  const { data } = await loose(supabase)
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('id', id)
    .eq('seller_id', shop.id)
    .maybeSingle();
  const product = data as ProductRow | null;
  if (!product) notFound();

  const categories = await loadCategories(supabase);

  return (
    <div className="animate-rise grid gap-5">
      <div>
        <Eyebrow>Menu</Eyebrow>
        <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
          Edit product
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[product.approval_status]}>{STATUS_LABEL[product.approval_status]}</Badge>
        </div>
        {product.review_note && (
          <p className="mt-3 rounded-[18px] bg-[var(--tile)] p-3.5 text-sm leading-relaxed">
            <span className="block text-xs font-bold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">
              Note from the team
            </span>
            {product.review_note}
          </p>
        )}
      </div>
      <ProductForm shopId={shop.id} defaultMode={shop.listing_mode} categories={categories} product={product} />
    </div>
  );
}
