import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { ThemeToggle } from '@/components/theme/theme-toggle';

const COLUMNS = [
  {
    title: 'For customers',
    links: [
      { href: '/browse', label: 'Browse nearby' },
      { href: '/orders', label: 'Track an order' },
      { href: '/favourites', label: 'Favourites' },
      { href: '/account', label: 'Your account' }
    ]
  },
  {
    title: 'For partners',
    links: [
      { href: '/business/apply', label: 'Sell on Localty' },
      { href: '/delivery/apply', label: 'Deliver with us' },
      { href: '/business', label: 'Shop dashboard' }
    ]
  },
  {
    title: 'Company',
    links: [
      { href: '/legal/terms', label: 'Terms' },
      { href: '/legal/privacy', label: 'Privacy' },
      { href: '/legal/refunds', label: 'Refunds' }
    ]
  }
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-[var(--surface)]">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[1.3fr_2fr] lg:px-10">
        <div>
          <Wordmark size={40} />
          <p className="mt-4 max-w-[36ch] text-sm leading-relaxed text-[var(--text-muted)]">
            A hyperlocal marketplace for Hyderabad. Zero commission to the shop, zero fees to you.
          </p>
          <p className="mt-5 text-sm text-[var(--text-muted)]">Abids, Hyderabad · 500001</p>

          <div className="mt-6">
            <span className="block text-[0.74rem] font-extrabold tracking-[0.16em] text-ink-500 uppercase">
              Appearance
            </span>
            <ThemeToggle className="mt-2.5" />
          </div>
        </div>

        <div className="grid gap-8 sm:grid-cols-3">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-[0.74rem] font-extrabold tracking-[0.16em] text-ink-500 uppercase">
                {column.title}
              </h3>
              <ul className="mt-4 grid gap-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[0.95rem] text-[var(--text-muted)] transition-colors hover:text-[var(--leaf-ink)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t">
        <p className="mx-auto max-w-7xl px-5 py-6 text-sm text-[var(--text-muted)] sm:px-8 lg:px-10">
          © {new Date().getFullYear()} Localty. Built for the shops on your street.
        </p>
      </div>
    </footer>
  );
}
