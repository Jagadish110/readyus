import type { Metadata } from 'next';
import { requireShop } from '@/lib/business/shop';
import { loadCategories } from '@/lib/business/categories';
import { Eyebrow } from '@/components/ui/card';
import { ProductForm } from '@/components/business/product-form';

export const metadata: Metadata = { title: 'Add product' };

export default async function NewProductPage() {
  const { shop } = await requireShop();
  const categories = await loadCategories();

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
      <ProductForm defaultMode={shop.listing_mode} categories={categories} />
    </div>
  );
}
