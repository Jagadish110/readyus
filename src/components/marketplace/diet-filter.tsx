'use client';

import { useOptimistic, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

export const DIETS = [
  { key: 'veg', label: 'Veg', dot: 'border-success bg-success' },
  { key: 'non_veg', label: 'Non-veg', dot: 'border-danger bg-danger' },
  { key: 'egg', label: 'Egg', dot: 'border-saffron-500 bg-saffron-500' }
] as const;

/** Veg / non-veg / egg switch for the food menu. Tapping the active one clears it. */
export function DietFilter({ active }: { active?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The tapped chip lights up at once; the results follow when they arrive.
  const [shown, setShown] = useOptimistic(active);

  function select(key?: string) {
    const next = new URLSearchParams(params.toString());
    const value = key && key !== shown ? key : undefined;
    if (value) next.set('diet', value);
    else next.delete('diet');
    startTransition(() => {
      setShown(value);
      // 'nav-filter': same page, new content, so the results crossfade (see RouteTransition).
      router.replace(`${pathname}?${next.toString()}`, { scroll: false, transitionTypes: ['nav-filter'] });
    });
  }

  return (
    <div role="group" aria-label="Diet" aria-busy={pending} className="flex shrink-0 gap-2">
      {DIETS.map((diet) => (
        <button
          key={diet.key}
          type="button"
          aria-pressed={shown === diet.key}
          onClick={() => select(diet.key)}
          className={cn(
            'inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-bold whitespace-nowrap ring-1 transition-[color,background-color,box-shadow,transform] active:scale-[0.96]',
            shown === diet.key
              ? 'animate-pop bg-[var(--leaf-soft)] text-[var(--leaf-ink)] ring-leaf-500'
              : 'bg-[var(--surface)] text-[var(--text-muted)] ring-[var(--line)] hover:text-[var(--leaf-ink)]',
            pending && shown === diet.key && 'animate-pulse'
          )}
        >
          <span aria-hidden className={cn('size-2.5 rounded-full border', diet.dot)} />
          {diet.label}
        </button>
      ))}
    </div>
  );
}
