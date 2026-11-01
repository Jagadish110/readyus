'use client';

import { useOptimistic, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { NearbyCategory } from '@/lib/database.types';
import { cn } from '@/lib/utils';

export function CategoryRail({
  categories,
  active
}: {
  categories: NearbyCategory[];
  active?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The tapped chip lights up at once; the results follow when they arrive.
  const [shown, setShown] = useOptimistic(active);

  if (!categories.length) return null;

  function select(key?: string) {
    const next = new URLSearchParams(params.toString());
    if (key) next.set('category', key);
    else next.delete('category');
    startTransition(() => {
      setShown(key);
      // 'nav-filter': same page, new content, so the results crossfade (see RouteTransition).
      router.replace(`${pathname}?${next.toString()}`, { scroll: false, transitionTypes: ['nav-filter'] });
    });
  }

  // The padding gives chips room to lift on hover and show their full border; the negative margins keep the
  // strip lined up with the page. A scrolling strip clips anything that sticks out of it.
  return (
    <div
      aria-busy={pending}
      className="no-scrollbar -mx-4 -my-1.5 flex min-w-0 gap-2.5 overflow-x-auto px-4 py-1.5 sm:-mx-1 sm:px-1">
      <Chip label="All" active={!shown} loading={pending && !shown} onClick={() => select()} />
      {categories.map((category) => (
        <Chip
          key={category.category_key}
          label={category.name}
          active={shown === category.category_key}
          loading={pending && shown === category.category_key}
          onClick={() => select(category.category_key)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  active,
  loading,
  onClick
}: {
  label: string;
  active: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-5 text-[0.92rem] font-bold whitespace-nowrap',
        'transition-[transform,background-color,border-color,color,box-shadow] duration-200 active:scale-[0.96]',
        active
          ? 'border-leaf-600 bg-leaf-600 text-white'
          : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)]',
        loading && 'animate-pulse'
      )}
    >
      {label}
    </button>
  );
}
