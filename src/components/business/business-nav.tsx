'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/business', label: 'Dashboard' },
  { href: '/business/orders', label: 'Orders' },
  { href: '/business/products', label: 'Products' },
  { href: '/business/payouts', label: 'Payouts' },
  { href: '/business/billing', label: 'Plan' }
];

export function BusinessNav() {
  const pathname = usePathname();
  return (
    <nav className="flex w-max gap-1 rounded-full border border-[var(--line)] bg-[var(--tile)] p-1">
      {LINKS.map(({ href, label }) => {
        const active = href === '/business' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-2.5 py-2 text-[0.8rem] font-bold whitespace-nowrap transition-colors sm:px-4 sm:text-sm',
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
