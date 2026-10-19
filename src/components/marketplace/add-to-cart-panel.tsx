'use client';

import type { NearbyProduct } from '@/lib/database.types';
import { useCart } from '@/lib/state/cart';
import { Button, ButtonLink } from '@/components/ui/button';
import { MinusIcon, PlusIcon } from '@/components/shell/icons';

export function AddToCartPanel({ product }: { product: NearbyProduct }) {
  const { add, setQuantity, quantityOf } = useCart();
  const quantity = quantityOf(product.id);
  const soldOut = product.stock <= 0;

  if (soldOut) {
    return (
      <p className="rounded-lg border-l-[3px] border-danger bg-danger/12 px-3.5 py-3 text-sm font-semibold text-[var(--text)]">
        Sold out right now.
      </p>
    );
  }

  if (quantity === 0) {
    return (
      <Button
        size="lg"
        fullWidth
        onClick={() =>
          add(
            {
              productId: product.id,
              sellerId: product.seller_id,
              sellerName: product.seller_name,
              name: product.name,
              unit: product.unit,
              price: product.price,
              mrp: product.mrp,
              vegType: product.veg_type,
              image: product.images?.[0] ?? null
            },
            product.min_order_qty
          )
        }
      >
        Add to cart
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex h-14 items-center gap-2 rounded-full bg-brand-500 px-2 text-white shadow-[0_8px_26px_rgb(255_77_28/0.32)]">
        <button
          type="button"
          aria-label="Remove one"
          onClick={() => setQuantity(product.id, quantity - 1)}
          className="grid size-10 place-items-center rounded-full transition-transform hover:bg-white/20 active:scale-90"
        >
          <MinusIcon className="size-4" />
        </button>
        <span className="min-w-8 text-center font-display text-lg font-extrabold tabular-nums">
          {quantity}
        </span>
        <button
          type="button"
          aria-label="Add one"
          disabled={quantity >= product.stock}
          onClick={() => setQuantity(product.id, quantity + 1)}
          className="grid size-10 place-items-center rounded-full transition-transform hover:bg-white/20 active:scale-90 disabled:opacity-40"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>

      <ButtonLink href="/cart" size="lg" variant="outline" className="flex-1">
        Go to cart
      </ButtonLink>
    </div>
  );
}
