'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/approvals', label: 'Approvals' },
  { href: '/admin/shops', label: 'Shops' },
  { href: '/admin/riders', label: 'Riders' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/admins', label: 'Admins' }
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex w-max gap-1 rounded-full border border-[var(--line)] bg-[var(--tile)] p-1">
      {LINKS.map(({ href, label }) => {
        const active = href === '/admin' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-2.5 py-2 text-[0.8rem] font-bold whitespace-nowrap transition-colors sm:px-4 sm:text-sm',
              active ? 'bg-[var(--surface)] text-[var(--leaf-ink)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
