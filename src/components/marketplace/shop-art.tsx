import Image from 'next/image';
import type { NearbySeller } from '@/lib/database.types';
import { Dish } from '@/components/art/dish-photo';
import { dishForSeller } from '@/components/art/dish-map';
import { cn } from '@/lib/utils';

/**
 * The picture for a shop: its own banner or photo when the owner uploaded one,
 * otherwise a stand-in dish. Fills its container, which must be positioned.
 */
export function ShopArt({
  shop,
  className,
  sizes,
  priority
}: {
  shop: NearbySeller;
  className?: string;
  sizes: string;
  priority?: boolean;
}) {
  const own = shop.banner_url || shop.photo_url;
  if (own) {
    return <Image src={own} alt="" fill sizes={sizes} priority={priority} className={cn('object-cover', className)} />;
  }
  return <Dish name={dishForSeller(shop)} sizes={sizes} priority={priority} className={className} />;
}
