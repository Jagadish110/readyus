'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/state/cart';
import { cn } from '@/lib/utils';
import { CartIcon, HomeIcon, OrdersIcon, SearchIcon, UserIcon } from './icons';

const TABS = [
  { href: '/browse', label: 'Home', Icon: HomeIcon },
  { href: '/search', label: 'Search', Icon: SearchIcon },
  { href: '/cart', label: 'Cart', Icon: CartIcon },
  { href: '/orders', label: 'Orders', Icon: OrdersIcon },
  { href: '/account', label: 'Account', Icon: UserIcon }
];

export function BottomNav() {
  const pathname = usePathname();
  const { count } = useCart();

  return (
    <nav
      aria-label="Primary"
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_26px_rgb(28_22_20/0.06)] md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2 py-1.5">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative isolate flex flex-col items-center gap-1 rounded-[14px] py-2 text-[0.68rem] font-semibold',
                  'transition-transform duration-150 ease-[var(--ease-spring)] active:scale-90',
                  active ? 'text-[var(--leaf-ink)]' : 'text-[var(--text-muted)]'
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="animate-pop absolute inset-x-2 inset-y-0.5 -z-10 rounded-full bg-[var(--leaf-soft)]"
                  />
                )}
                <span className="relative">
                  <Icon className="size-[22px]" />
                  {href === '/cart' && count > 0 && (
                    <span className="absolute -top-1.5 -right-2 grid min-w-[18px] place-items-center rounded-full border-2 border-[var(--surface)] bg-brand-500 px-1 text-[0.6rem] font-extrabold text-white">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
