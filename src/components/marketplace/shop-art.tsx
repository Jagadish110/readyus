import Image from 'next/image';
import type { NearbySeller } from '@/lib/database.types';
import { cn } from '@/lib/utils';
import { NoPhoto } from './no-photo';

/**
 * The picture for a shop: its own banner or photo when the owner uploaded one, otherwise its initial on a
 * plain tile (never a stock photo). Fills its container, which must be positioned.
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
  return <NoPhoto name={shop.shop_name} className={className} />;
}
