'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SearchIcon } from '@/components/shell/icons';

const IDEAS = ['biryani', 'dosa', 'kebabs', 'chai', 'shops nearby'];

/** The way into search, styled as a search box. The word it suggests changes every few seconds. */
export function SearchPrompt() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((current) => (current + 1) % IDEAS.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Link
      href="/search"
      transitionTypes={['nav-forward']}
      aria-label="Search for dishes and shops"
      className="flex h-14 items-center gap-3 overflow-hidden rounded-full bg-white px-5 text-[0.98rem] font-medium text-ink-600 shadow-[0_10px_28px_rgb(15_44_29/0.3)] transition-transform duration-200 ease-[var(--ease-smooth)] hover:-translate-y-0.5 active:scale-[0.98]"
    >
      <SearchIcon className="size-5 shrink-0 text-leaf-600" />
      <span aria-hidden className="flex min-w-0 gap-[0.3em] whitespace-nowrap">
        Search
        <span key={IDEAS[index]} className="animate-tick-up inline-block font-bold text-ink-900">
          {IDEAS[index]}
        </span>
      </span>
    </Link>
  );
}
