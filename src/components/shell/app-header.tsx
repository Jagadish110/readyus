'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocation, RADIUS_OPTIONS } from '@/lib/state/location';
import { useCart } from '@/lib/state/cart';
import { LogoMark } from '@/components/brand/logo';
import { cn } from '@/lib/utils';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { useChangePulse } from '@/components/motion/use-change-pulse';
import { AccountLink } from './account-link';
import { CartIcon, ChevronIcon, PinIcon, SearchIcon } from './icons';

/**
 * True while the person is scrolling down the page, past the bar's own height; false as soon as they
 * scroll up or are near the top. Small jitters are ignored so the bar does not flicker.
 */
function useTuckOnScroll() {
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < 80) setTucked(false);
        else if (y - last > 8) setTucked(true);
        else if (last - y > 8) setTucked(false);
        if (Math.abs(y - last) > 8 || y < 80) last = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  return tucked;
}

export function AppHeader() {
  const { location, setRadius } = useLocation();
  const { count, ready } = useCart();
  // The badge bounces when something lands in the cart.
  const cartPulse = useChangePulse(count, ready);
  const [radiusOpen, setRadiusOpen] = useState(false);
  const tucked = useTuckOnScroll() && !radiusOpen;

  return (
    <header
      className={cn(
        'glass sticky top-0 z-40 border-b border-[var(--line)] transition-transform duration-300 ease-[var(--ease-smooth)] motion-reduce:transition-none',
        // Phones only: the bar slides away while scrolling down and returns on any scroll up.
        tucked && 'max-md:-translate-y-full'
      )}
      style={{ viewTransitionName: 'app-header' }}
    >
      <div className="mx-auto flex h-[72px] w-full max-w-6xl items-center gap-2.5 px-4 sm:gap-3 sm:px-6">
        <Link href="/" aria-label="Localty home" className="shrink-0">
          <LogoMark className="size-10" />
        </Link>

        {/* Location + radius: the single most important control in the app. */}
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setRadiusOpen((open) => !open)}
            aria-expanded={radiusOpen}
            className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-full px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--leaf-soft)]"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--leaf-soft)] text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
              <PinIcon className="size-[18px]" />
            </span>
            <span className="grid min-w-0">
              <span className="flex items-center gap-1 text-[0.62rem] font-extrabold tracking-[0.1em] whitespace-nowrap text-[var(--leaf-ink)] uppercase">
                Delivering to
                {/* On a phone the radius rides on this line, so the place name below gets the full width. */}
                {location && (
                  <span className="flex items-center gap-0.5 md:hidden">
                    · {location.radiusKm} km
                    <ChevronIcon className={cn('size-3 transition-transform', radiusOpen && 'rotate-90')} />
                  </span>
                )}
              </span>
              <span className="truncate text-[0.9rem] font-bold" title={location?.label}>
                {location ? location.label.split(',')[0] : 'Choose your location'}
              </span>
            </span>
            {location && (
              <span className="ml-auto hidden shrink-0 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-xs font-bold shadow-xs md:flex">
                {location.radiusKm} km
                <ChevronIcon className={cn('size-3.5 transition-transform', radiusOpen && 'rotate-90')} />
              </span>
            )}
          </button>

          {radiusOpen && location && (
            <div className="animate-pop absolute top-full left-0 z-50 mt-2 w-60 rounded-[22px] border border-[var(--line)] bg-[var(--surface)] p-2 shadow-xl">
              <p className="px-3 pt-1 pb-2 text-[0.68rem] font-extrabold tracking-[0.14em] text-ink-400 uppercase">
                Show shops within
              </p>
              {RADIUS_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setRadius(option);
                    setRadiusOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-[14px] px-3 py-2.5 text-sm font-semibold transition-colors',
                    option === location.radiusKm
                      ? 'bg-[var(--leaf-soft)] text-[var(--leaf-ink)]'
                      : 'hover:bg-[var(--surface-subtle)] hover:text-[var(--leaf-ink)]'
                  )}
                >
                  {option} km
                  {option === location.radiusKm && <span aria-hidden>✓</span>}
                </button>
              ))}
              <Link
                href="/location"
                onClick={() => setRadiusOpen(false)}
                className="mt-1 block rounded-[14px] px-3 py-2.5 text-sm font-bold text-[var(--leaf-ink)] hover:bg-[var(--leaf-soft)]"
              >
                Change location
              </Link>
            </div>
          )}
        </div>

        {/* On a phone Search and Account live in the bottom bar, so the delivery location gets this room. */}
        <Link
          href="/search"
          transitionTypes={['nav-tab']}
          aria-label="Search"
          className="hidden size-10 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] shadow-xs transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)] md:grid"
        >
          <SearchIcon className="size-[19px]" />
        </Link>

        <NotificationCenter />

        <div className="hidden md:block">
          <AccountLink />
        </div>

        <Link
          href="/cart"
          transitionTypes={['nav-tab']}
          aria-label={`Cart, ${count} items`}
          className="relative hidden size-10 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] shadow-xs transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)] md:grid"
        >
          <CartIcon className="size-[19px]" />
          {count > 0 && (
            <span
              key={cartPulse.count}
              className={cn(
                'absolute -top-1 -right-1 grid min-w-[18px] place-items-center rounded-full border-2 border-[var(--surface)] bg-brand-500 px-1 text-[0.6rem] font-extrabold text-white',
                cartPulse.count > 0 && cartPulse.up && 'animate-bump'
              )}
            >
              {count > 99 ? '99+' : count}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
