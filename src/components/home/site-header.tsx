'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { LogoMark } from '@/components/brand/logo';
import { CartIcon, SearchIcon } from '@/components/shell/icons';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { AccountLink } from '@/components/shell/account-link';
import { useSignedIn } from '@/lib/state/session';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/browse', label: 'Browse' },
  { href: '/browse?mode=items', label: 'Shops' },
  { href: '/business/apply', label: 'Sell' }
];

/**
 * Landing header. Transparent over the hero, then lifts onto a frosted bar
 * once the page scrolls — so the headline is never fighting a white slab.
 */
export function SiteHeader() {
  const [lifted, setLifted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const signedIn = useSignedIn();

  React.useEffect(() => {
    const onScroll = () => setLifted(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-300',
        lifted ? 'glass shadow-[0_10px_30px_rgb(28_22_20/0.07)]' : 'bg-transparent'
      )}
    >
      <div className="mx-auto flex h-18 max-w-7xl items-center gap-4 px-5 sm:px-8 lg:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <LogoMark className="size-10 rounded-[13px]" />
          <span className="font-display text-xl font-extrabold tracking-[-0.04em]">ReadyUs</span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((item, index) => (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                'relative rounded-full px-4 py-2 text-[0.94rem] font-semibold transition-colors',
                index === 0
                  ? 'text-[var(--leaf-ink)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--leaf-soft)] hover:text-[var(--leaf-ink)]'
              )}
            >
              {item.label}
              {index === 0 && (
                <span className="absolute inset-x-4 -bottom-0.5 h-0.5 rounded-full bg-leaf-500" />
              )}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <label className="hidden h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] pr-2 pl-4 shadow-xs transition-colors focus-within:border-leaf-400 md:flex">
            <SearchIcon className="size-4 text-[var(--text-muted)]" />
            <input
              type="search"
              placeholder="Search biryani, dosa, rice…"
              className="w-44 bg-transparent text-sm outline-none placeholder:text-ink-400 lg:w-36 xl:w-52"
            />
          </label>

          <ThemeToggle className="hidden lg:inline-flex" />

          <Link
            href="/cart"
            aria-label="Cart"
            className="grid size-11 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] shadow-xs transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)]"
          >
            <CartIcon className="size-5" />
          </Link>

          {signedIn ? (
            <AccountLink />
          ) : (
          <Link
            href="/sign-up"
            className="hidden h-11 items-center rounded-full bg-leaf-600 px-6 text-[0.94rem] font-bold text-white shadow-[0_8px_22px_rgb(36_101_64/0.3)] transition-[transform,box-shadow,background-color] hover:-translate-y-0.5 hover:bg-leaf-700 hover:shadow-[0_14px_30px_rgb(36_101_64/0.36)] active:scale-[0.97] sm:inline-flex"
          >
            Sign up
          </Link>
          )}

          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="grid size-11 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] shadow-xs lg:hidden"
          >
            <span className="relative block h-3 w-4.5">
              <span
                className={cn(
                  'absolute inset-x-0 top-0 h-0.5 rounded-full bg-current transition-transform duration-300',
                  open && 'translate-y-[5px] rotate-45'
                )}
              />
              <span
                className={cn(
                  'absolute inset-x-0 top-[5px] h-0.5 rounded-full bg-current transition-opacity duration-200',
                  open && 'opacity-0'
                )}
              />
              <span
                className={cn(
                  'absolute inset-x-0 top-[10px] h-0.5 rounded-full bg-current transition-transform duration-300',
                  open && '-translate-y-[5px] -rotate-45'
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {/* Mobile sheet */}
      <div
        className={cn(
          'grid overflow-hidden transition-[grid-template-rows] duration-300 ease-[var(--ease-smooth)] lg:hidden',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="min-h-0">
          <nav className="mx-5 mb-3 grid gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-lg sm:mx-8">
            {NAV.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--leaf-soft)] hover:text-[var(--leaf-ink)]"
              >
                {item.label}
              </Link>
            ))}
            {!signedIn && (
            <Link
              href="/sign-up"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-xl bg-leaf-600 px-4 py-3 text-center font-bold text-white"
            >
              Sign up
            </Link>
            )}

            <div className="mt-2 flex items-center justify-between gap-3 border-t px-4 pt-3">
              <span className="text-[0.82rem] font-bold tracking-[0.12em] text-[var(--text-muted)] uppercase">
                Theme
              </span>
              <ThemeToggle />
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}
