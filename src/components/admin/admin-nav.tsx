'use client';

import { useEffect, useRef } from 'react';
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
  const activeRef = useRef<HTMLAnchorElement>(null);

  // On a phone the six tabs scroll sideways; keep the current one in view instead of off the edge.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    <nav className="flex w-max gap-1 rounded-full border border-[var(--line)] bg-[var(--tile)] p-1">
      {LINKS.map(({ href, label }) => {
        const active = href === '/admin' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            ref={active ? activeRef : undefined}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-11 items-center rounded-full px-3.5 text-sm font-bold whitespace-nowrap transition-colors sm:h-9 sm:px-4',
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
