import Image from 'next/image';
import type { NearbySeller } from '@/lib/database.types';
import { cn } from '@/lib/utils';
import { NoPhoto } from './no-photo';

/**
 * The picture for a shop: its own banner or photo when the owner uploaded one, otherwise its initial on a
 * plain tile (never a stock photo). `kind` picks which comes first: the wide banner (cards, the shop page
 * header) or the round profile photo; each falls back to the other. Fills its container, which must be positioned.
 */
export function ShopArt({
  shop,
  className,
  sizes,
  priority,
  kind = 'banner'
}: {
  shop: Pick<NearbySeller, 'shop_name' | 'photo_url' | 'banner_url'>;
  className?: string;
  sizes: string;
  priority?: boolean;
  kind?: 'banner' | 'photo';
}) {
  const own = kind === 'photo' ? shop.photo_url || shop.banner_url : shop.banner_url || shop.photo_url;
  if (own) {
    return <Image src={own} alt="" fill sizes={sizes} priority={priority} className={cn('object-cover', className)} />;
  }
  return <NoPhoto name={shop.shop_name} className={className} />;
}
