'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/business', label: 'Dashboard' },
  { href: '/business/products', label: 'Products' }
];

export function BusinessNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 rounded-full border border-[var(--line)] bg-[var(--tile)] p-1">
      {LINKS.map(({ href, label }) => {
        const active = href === '/business' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-bold transition-colors',
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
