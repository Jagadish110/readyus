import type { NearbyCategory } from '@/lib/database.types';

/**
 * The everyday dishes the food browse offers, in the order a customer looks for
 * them. The keys match `public.categories` (see migrations 0034 and 0038), which is also
 * what sellers pick from when they list a dish. Veg / non-veg / egg is a
 * separate filter, because it is a property of each dish rather than a kind of food.
 */
export const FOOD_CATEGORIES: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'biryani', name: 'Biryani' },
  { key: 'meals', name: 'Meals' },
  { key: 'tiffins', name: 'Tiffins' },
  { key: 'chicken', name: 'Chicken' },
  { key: 'mutton', name: 'Mutton' },
  { key: 'seafood', name: 'Fish & Prawns' },
  { key: 'curries', name: 'Curries' },
  { key: 'chinese', name: 'Chinese' },
  { key: 'pizza', name: 'Pizza' },
  { key: 'burgers', name: 'Burgers' },
  { key: 'combos', name: 'Combos' },
  { key: 'rolls', name: 'Rolls & Wraps' },
  { key: 'snacks', name: 'Snacks' },
  { key: 'kebabs', name: 'Kebabs' },
  { key: 'desserts', name: 'Sweets' },
  { key: 'bakery', name: 'Bakery' },
  { key: 'beverages', name: 'Chai & Drinks' }
];

/**
 * Always offers the full list so customers can see what Localty covers, even
 * where few kitchens have joined. Anything a shop has listed under a key that is
 * not in the list is appended rather than hidden.
 */
export function foodCategoryRail(nearby: NearbyCategory[]): NearbyCategory[] {
  const counts = new Map(nearby.map((category) => [category.category_key, category]));
  const known = new Set(FOOD_CATEGORIES.map((category) => category.key));

  return [
    ...FOOD_CATEGORIES.map((category) => ({
      category_key: category.key,
      name: category.name,
      product_count: counts.get(category.key)?.product_count ?? 0
    })),
    ...nearby.filter((category) => !known.has(category.category_key))
  ];
}
