import type { Metadata } from 'next';
import { requireShop } from '@/lib/business/shop';
import { loadCategories } from '@/lib/business/categories';
import type { ProductRow } from '@/lib/business/db';
import { serverApi } from '@/lib/api/server';
import { Eyebrow } from '@/components/ui/card';
import { ProductForm } from '@/components/business/product-form';

export const metadata: Metadata = { title: 'Add product' };

export default async function NewProductPage() {
  const { shop } = await requireShop();
  const [categories, listed] = await Promise.all([
    loadCategories(),
    serverApi<{ products: ProductRow[] }>('/v1/seller/products')
  ]);
  // The shop's own products, to pick from when building a combo. Without them a combo is typed in.
  const menu = listed.ok ? listed.data.products.map((item) => ({ id: item.id, name: item.name })) : [];

  return (
    <div className="animate-rise grid gap-5">
      <div>
        <Eyebrow>Menu</Eyebrow>
        <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
          Add a product
        </h1>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">
          New products are reviewed by our team before customers can see them.
        </p>
      </div>
      <ProductForm defaultMode={shop.listing_mode} categories={categories} menu={menu} />
    </div>
  );
}
