import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Photography for the dishes the landing page shows.
 *
 * Files live in public/food and came from Pexels, whose licence allows
 * commercial use without attribution; see public/food/CREDITS.md for the
 * source of each one. Next's Image serves them resized and in a modern
 * format, so the large originals never reach the browser.
 */
export const DISH_PHOTOS = {
  biryani: { src: '/food/biryani.jpg', alt: 'A plate of saffron biryani garnished with lemon and tomato' },
  dosa: { src: '/food/dosa.jpg', alt: 'A crisp masala dosa served with chutneys and sambar' },
  kebab: { src: '/food/kebab.jpg', alt: 'Grilled seekh kebabs on a platter with garnish' },
  idli: { src: '/food/idli.jpg', alt: 'Steamed idli with sambar and coconut chutney' },
  sweet: { src: '/food/sweet.jpg', alt: 'An assortment of traditional Indian sweets' },
  chai: { src: '/food/chai.jpg', alt: 'A glass of spiced chai with biscuits' },
  veg: { src: '/food/veg.jpg', alt: 'Fresh vegetables arranged in a basket' },
  kirana: { src: '/food/kirana.jpg', alt: 'Jars and bowls of rice, grains and pulses' }
} as const;

/**
 * Listings that have a photo of the exact item rather than a stand-in dish.
 * Keyed by fixture id so the lookup in `product-photo.ts` is a direct hit.
 */
export const PRODUCT_PHOTOS = {
  'p-biryani-chicken': { src: '/food/products/p-biryani-chicken.jpg', alt: 'Chicken biryani garnished with mint' },
  'p-biryani-mutton': { src: '/food/products/p-biryani-mutton.jpg', alt: 'Mutton curry served in a traditional pot' },
  'p-biryani-veg': { src: '/food/products/p-biryani-veg.jpg', alt: 'Vegetable pulao served with sides' },
  'p-dessert-dkm': { src: '/food/products/p-dessert-dkm.jpg', alt: 'An Indian milk-soaked dessert in a bowl' },
  'p-tiffin-pesarattu': { src: '/food/products/p-tiffin-pesarattu.jpg', alt: 'Upma served with assorted chutneys' },
  'p-bev-coffee': { src: '/food/products/p-bev-coffee.jpg', alt: 'Coffee brewing through a filter, seen from above' },
  'p-bakery-osmania': { src: '/food/products/p-bakery-osmania.jpg', alt: 'A stack of round tea biscuits' },
  'p-bakery-puff': { src: '/food/products/p-bakery-puff.jpg', alt: 'Savoury filled pastries on a wooden board' },
  'p-gro-rice': { src: '/food/products/p-gro-rice.jpg', alt: 'Uncooked rice grains in a bowl' },
  'p-gro-dal': { src: '/food/products/p-gro-dal.jpg', alt: 'Dried split lentils' },
  'p-gro-oil': { src: '/food/products/p-gro-oil.jpg', alt: 'Bottles of cooking oil' },
  'p-hh-detergent': { src: '/food/products/p-hh-detergent.jpg', alt: 'Household cleaning supplies arranged together' },
  'p-veg-tomato': { src: '/food/products/p-veg-tomato.jpg', alt: 'Fresh red tomatoes on a market stall' },
  'p-veg-onion': { src: '/food/products/p-veg-onion.jpg', alt: 'A pile of fresh brown onions' },
  'p-fruit-banana': { src: '/food/products/p-fruit-banana.jpg', alt: 'A bunch of ripe bananas' },
  'p-fruit-apple': { src: '/food/products/p-fruit-apple.jpg', alt: 'A bowl of fresh red apples' }
} as const;

const PHOTOS = { ...DISH_PHOTOS, ...PRODUCT_PHOTOS };

export type DishKey = keyof typeof DISH_PHOTOS;
export type PhotoKey = keyof typeof PHOTOS;

type DishProps = {
  name: PhotoKey;
  className?: string;
  /** Widths the image is rendered at, so the browser picks the right file. */
  sizes?: string;
  /** Set on the hero image only — it is the largest paint on first view. */
  priority?: boolean;
};

/**
 * Fills its container, which must be positioned and have a size of its own
 * (an aspect ratio or explicit height).
 */
export function Dish({ name, className, sizes = '(max-width: 640px) 90vw, 30vw', priority }: DishProps) {
  const photo = PHOTOS[name];
  return (
    <Image
      src={photo.src}
      alt={photo.alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn('object-cover', className)}
    />
  );
}
