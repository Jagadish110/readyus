'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { BoxIcon, GridIcon, OrdersIcon, StarIcon, WalletIcon } from '@/components/shell/icons';

const LINKS = [
  { href: '/business', label: 'Dashboard', Icon: GridIcon },
  { href: '/business/orders', label: 'Orders', Icon: OrdersIcon },
  { href: '/business/products', label: 'Products', Icon: BoxIcon },
  { href: '/business/payouts', label: 'Payouts', Icon: WalletIcon },
  { href: '/business/billing', label: 'Plan', Icon: StarIcon }
];

const isActive = (pathname: string, href: string) => (href === '/business' ? pathname === href : pathname.startsWith(href));

/** Tabs across the top on desktops. */
export function BusinessNav() {
  const pathname = usePathname();
  return (
    <nav className="flex w-max gap-1 rounded-full border border-[var(--line)] bg-[var(--tile)] p-1">
      {LINKS.map(({ href, label }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            transitionTypes={['nav-tab']}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition-colors',
              active
                ? 'bg-[var(--surface)] text-[var(--leaf-ink)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** On phones and tablets the same five places sit in a bottom bar, where a thumb reaches them while serving customers. */
export function BusinessTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Shop console"
      // Named so it holds still while pages change (see the page transition rules in globals.css).
      style={{ viewTransitionName: 'bottom-nav' }}
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_26px_rgb(28_22_20/0.06)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-2 py-1.5">
        {LINKS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                transitionTypes={['nav-tab']}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative isolate flex min-h-12 flex-col items-center justify-center gap-1 rounded-[14px] py-1.5 text-[0.68rem] font-semibold',
                  'transition-transform duration-150 ease-[var(--ease-spring)] active:scale-90',
                  active ? 'text-[var(--leaf-ink)]' : 'text-[var(--text-muted)]'
                )}
              >
                {active && (
                  // One highlight, named, so a tab change glides it from the old tab to the new one.
                  <span
                    aria-hidden
                    style={{ viewTransitionName: 'nav-pill' }}
                    className="absolute inset-x-1.5 inset-y-0.5 -z-10 rounded-full bg-[var(--leaf-soft)]"
                  />
                )}
                <Icon className="size-[22px]" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
