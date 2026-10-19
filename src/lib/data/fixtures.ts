/**
 * Development fixtures.
 *
 * These let every screen render before a Supabase project is connected. The
 * shapes match the rows the real queries return, so swapping to live data is a
 * change of source only, never of component code.
 *
 * Coordinates sit around Abids, Hyderabad so the radius rules behave sensibly.
 */

import type { NearbyProduct, NearbySeller } from '@/lib/database.types';

export const FIXTURE_ORIGIN = { lat: 17.385, lng: 78.4867, label: 'Abids, Hyderabad' };

type SellerSeed = Omit<NearbySeller, 'distance_km'> & { distance_km: number };

export const FIXTURE_SELLERS: SellerSeed[] = [
  {
    id: 'seed-paradise',
    shop_name: 'Paradise Corner Biryani',
    category: 'Biryani & Kebabs',
    listing_mode: 'food',
    description: 'Dum biryani cooked in sealed handis since 1998. Family packs available.',
    address: 'Opp. GPO, Abids',
    city: 'Hyderabad',
    photo_url: null,
    banner_url: null,
    rating: 4.6,
    rating_count: 1284,
    business_open: true,
    eta_minutes: 32,
    min_order_amount: 149,
    delivery_fee: 25,
    free_delivery_above: 499,
    cod_available: true,
    distance_km: 0.48
  },
  {
    id: 'seed-lakshmi',
    shop_name: 'Sri Lakshmi Tiffin House',
    category: 'South Indian',
    listing_mode: 'food',
    description: 'Idli, dosa and pesarattu from 6am. Filter coffee all day.',
    address: 'Bank Street, Koti',
    city: 'Hyderabad',
    photo_url: null,
    banner_url: null,
    rating: 4.4,
    rating_count: 642,
    business_open: true,
    eta_minutes: 22,
    min_order_amount: 99,
    delivery_fee: 19,
    free_delivery_above: 299,
    cod_available: true,
    distance_km: 0.92
  },
  {
    id: 'seed-charminar',
    shop_name: 'Charminar Chai & Bakery',
    category: 'Bakery & Beverages',
    listing_mode: 'food',
    description: 'Irani chai, Osmania biscuits and fresh bakes through the day.',
    address: 'Pathergatti Road',
    city: 'Hyderabad',
    photo_url: null,
    banner_url: null,
    rating: 4.7,
    rating_count: 2103,
    business_open: false,
    eta_minutes: 18,
    min_order_amount: 60,
    delivery_fee: 15,
    free_delivery_above: 249,
    cod_available: true,
    distance_km: 1.64
  },
  {
    id: 'seed-balaji',
    shop_name: 'Balaji Kirana Store',
    category: 'Grocery',
    listing_mode: 'items',
    description: 'Daily staples, pulses, oils and household supplies.',
    address: 'Troop Bazaar, Abids',
    city: 'Hyderabad',
    photo_url: null,
    banner_url: null,
    rating: 4.3,
    rating_count: 318,
    business_open: true,
    eta_minutes: 40,
    min_order_amount: 199,
    delivery_fee: 29,
    free_delivery_above: 799,
    cod_available: true,
    distance_km: 0.74
  },
  {
    id: 'seed-freshfarm',
    shop_name: 'FreshFarm Fruits & Veg',
    category: 'Fruits & Vegetables',
    listing_mode: 'items',
    description: 'Picked each morning from Gaddiannaram market.',
    address: 'Nampally Station Road',
    city: 'Hyderabad',
    photo_url: null,
    banner_url: null,
    rating: 4.5,
    rating_count: 487,
    business_open: true,
    eta_minutes: 35,
    min_order_amount: 149,
    delivery_fee: 25,
    free_delivery_above: 599,
    cod_available: false,
    distance_km: 1.21
  }
];

type ProductSeed = {
  id: string;
  seller_id: string;
  name: string;
  description: string;
  category_key: string;
  price: number;
  mrp: number | null;
  unit: string;
  stock: number;
  veg_type: string;
  rating: number;
  rating_count: number;
  tags?: string[];
};

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    id: 'p-biryani-chicken', seller_id: 'seed-paradise',
    name: 'Chicken Dum Biryani', description: 'Full plate with raita and salan.',
    category_key: 'biryani', price: 320, mrp: 380, unit: 'full plate',
    stock: 40, veg_type: 'non_veg', rating: 4.7, rating_count: 512, tags: ['bestseller']
  },
  {
    id: 'p-biryani-mutton', seller_id: 'seed-paradise',
    name: 'Mutton Dum Biryani', description: 'Slow-cooked with bone-in mutton.',
    category_key: 'biryani', price: 420, mrp: 480, unit: 'full plate',
    stock: 18, veg_type: 'non_veg', rating: 4.8, rating_count: 388
  },
  {
    id: 'p-biryani-veg', seller_id: 'seed-paradise',
    name: 'Veg Dum Biryani', description: 'Seasonal vegetables and saffron rice.',
    category_key: 'biryani', price: 220, mrp: 260, unit: 'full plate',
    stock: 32, veg_type: 'veg', rating: 4.3, rating_count: 176
  },
  {
    id: 'p-kebab-seekh', seller_id: 'seed-paradise',
    name: 'Seekh Kebab (6 pcs)', description: 'Charcoal grilled, with mint chutney.',
    category_key: 'kebabs', price: 260, mrp: 300, unit: '6 pcs',
    stock: 25, veg_type: 'non_veg', rating: 4.5, rating_count: 203
  },
  {
    id: 'p-dessert-dkm', seller_id: 'seed-paradise',
    name: 'Double Ka Meetha', description: 'Hyderabadi bread pudding with dry fruits.',
    category_key: 'desserts', price: 90, mrp: 110, unit: 'bowl',
    stock: 20, veg_type: 'veg', rating: 4.4, rating_count: 97
  },
  {
    id: 'p-tiffin-idli', seller_id: 'seed-lakshmi',
    name: 'Idli Plate (4 pcs)', description: 'Steamed soft idli with sambar and chutney.',
    category_key: 'tiffins', price: 50, mrp: 60, unit: '4 pcs',
    stock: 60, veg_type: 'veg', rating: 4.4, rating_count: 221
  },
  {
    id: 'p-tiffin-dosa', seller_id: 'seed-lakshmi',
    name: 'Masala Dosa', description: 'Crisp dosa with spiced potato filling.',
    category_key: 'tiffins', price: 80, mrp: 95, unit: '1 pc',
    stock: 45, veg_type: 'veg', rating: 4.6, rating_count: 410, tags: ['bestseller']
  },
  {
    id: 'p-tiffin-pesarattu', seller_id: 'seed-lakshmi',
    name: 'Pesarattu Upma', description: 'Green gram dosa served with upma.',
    category_key: 'tiffins', price: 95, mrp: null, unit: '1 pc',
    stock: 30, veg_type: 'veg', rating: 4.5, rating_count: 134
  },
  {
    id: 'p-bev-coffee', seller_id: 'seed-lakshmi',
    name: 'Filter Coffee', description: 'Strong decoction, served hot.',
    category_key: 'beverages', price: 35, mrp: null, unit: 'cup',
    stock: 100, veg_type: 'veg', rating: 4.7, rating_count: 589
  },
  {
    id: 'p-bev-irani', seller_id: 'seed-charminar',
    name: 'Irani Chai', description: 'The classic, brewed slow.',
    category_key: 'beverages', price: 25, mrp: null, unit: 'cup',
    stock: 200, veg_type: 'veg', rating: 4.8, rating_count: 1420, tags: ['bestseller']
  },
  {
    id: 'p-bakery-osmania', seller_id: 'seed-charminar',
    name: 'Osmania Biscuits (250g)', description: 'Lightly salted tea biscuits.',
    category_key: 'bakery', price: 70, mrp: 85, unit: '250 g',
    stock: 50, veg_type: 'veg', rating: 4.6, rating_count: 332
  },
  {
    id: 'p-bakery-puff', seller_id: 'seed-charminar',
    name: 'Veg Puff', description: 'Flaky pastry with spiced filling.',
    category_key: 'bakery', price: 30, mrp: null, unit: '1 pc',
    stock: 80, veg_type: 'veg', rating: 4.2, rating_count: 188
  },
  {
    id: 'p-gro-rice', seller_id: 'seed-balaji',
    name: 'Sona Masoori Rice 5kg', description: 'Premium aged rice.',
    category_key: 'staples', price: 420, mrp: 480, unit: '5 kg',
    stock: 24, veg_type: 'veg', rating: 4.3, rating_count: 86
  },
  {
    id: 'p-gro-dal', seller_id: 'seed-balaji',
    name: 'Toor Dal 1kg', description: 'Unpolished split pigeon peas.',
    category_key: 'staples', price: 160, mrp: 185, unit: '1 kg',
    stock: 40, veg_type: 'veg', rating: 4.4, rating_count: 52
  },
  {
    id: 'p-gro-oil', seller_id: 'seed-balaji',
    name: 'Sunflower Oil 1L', description: 'Refined cooking oil pouch.',
    category_key: 'staples', price: 140, mrp: 165, unit: '1 L',
    stock: 36, veg_type: 'veg', rating: 4.1, rating_count: 41
  },
  {
    id: 'p-hh-detergent', seller_id: 'seed-balaji',
    name: 'Detergent Powder 1kg', description: 'For machine and hand wash.',
    category_key: 'household', price: 110, mrp: 130, unit: '1 kg',
    stock: 28, veg_type: '', rating: 4.0, rating_count: 33
  },
  {
    id: 'p-veg-tomato', seller_id: 'seed-freshfarm',
    name: 'Tomatoes 1kg', description: 'Firm, ripe and locally grown.',
    category_key: 'vegetables', price: 40, mrp: 55, unit: '1 kg',
    stock: 70, veg_type: 'veg', rating: 4.2, rating_count: 64
  },
  {
    id: 'p-veg-onion', seller_id: 'seed-freshfarm',
    name: 'Onions 2kg', description: 'Medium size, good for daily cooking.',
    category_key: 'vegetables', price: 76, mrp: 90, unit: '2 kg',
    stock: 55, veg_type: 'veg', rating: 4.3, rating_count: 71
  },
  {
    id: 'p-fruit-banana', seller_id: 'seed-freshfarm',
    name: 'Banana (dozen)', description: 'Yelakki variety, naturally ripened.',
    category_key: 'fruits', price: 60, mrp: 72, unit: '12 pcs',
    stock: 48, veg_type: 'veg', rating: 4.5, rating_count: 112, tags: ['bestseller']
  },
  {
    id: 'p-fruit-apple', seller_id: 'seed-freshfarm',
    name: 'Shimla Apples 1kg', description: 'Crisp and sweet.',
    category_key: 'fruits', price: 180, mrp: 220, unit: '1 kg',
    stock: 30, veg_type: 'veg', rating: 4.4, rating_count: 58
  }
];

export const FIXTURE_PRODUCTS: NearbyProduct[] = PRODUCT_SEEDS.map((seed) => {
  const seller = FIXTURE_SELLERS.find((item) => item.id === seed.seller_id)!;
  return {
    id: seed.id,
    seller_id: seed.seller_id,
    seller_name: seller.shop_name,
    name: seed.name,
    description: seed.description,
    category_key: seed.category_key,
    listing_mode: seller.listing_mode,
    price: seed.price,
    mrp: seed.mrp,
    unit: seed.unit,
    stock: seed.stock,
    min_order_qty: 1,
    images: [],
    veg_type: seed.veg_type,
    variants: [],
    rating: seed.rating,
    rating_count: seed.rating_count,
    business_open: seller.business_open,
    eta_minutes: seller.eta_minutes,
    distance_km: seller.distance_km
  };
});

export const FIXTURE_CATEGORY_LABELS: Record<string, string> = {
  biryani: 'Biryani',
  kebabs: 'Kebabs',
  tiffins: 'Tiffins',
  desserts: 'Desserts',
  bakery: 'Bakery',
  beverages: 'Beverages',
  staples: 'Staples',
  household: 'Household',
  vegetables: 'Vegetables',
  fruits: 'Fruits'
};

/** Which fixture products a tag marks, used for the home rails. */
export const FIXTURE_BESTSELLERS = new Set(
  PRODUCT_SEEDS.filter((seed) => seed.tags?.includes('bestseller')).map((seed) => seed.id)
);
