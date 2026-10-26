'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/state/cart';
import { formatRupees } from '@/lib/utils';

// Pages where a customer is still choosing food; elsewhere the cart is the page itself or not the point.
const BROWSING = ['/browse', '/shop', '/product', '/search'];

/** On a phone, keeps the basket and the way to pay one tap away while the customer keeps adding. */
export function CartBar() {
  const pathname = usePathname();
  const { count, subtotal, ready } = useCart();

  if (!ready || count === 0 || !BROWSING.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 px-4 md:hidden">
      <Link
        href="/cart"
        className="animate-rise pointer-events-auto mx-auto flex max-w-lg items-center justify-between gap-3 rounded-full bg-leaf-600 px-5 py-3.5 text-white shadow-[0_14px_34px_rgb(36_101_64/0.4)] active:scale-[0.98]"
      >
        <span className="text-sm font-bold">
          {count} {count === 1 ? 'item' : 'items'} <span aria-hidden>·</span> {formatRupees(subtotal)}
        </span>
        <span className="text-sm font-extrabold">View cart →</span>
      </Link>
    </div>
  );
}
