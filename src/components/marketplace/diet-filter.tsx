'use client';

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

  function select(key?: string) {
    const next = new URLSearchParams(params.toString());
    if (key && key !== active) next.set('diet', key);
    else next.delete('diet');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div role="group" aria-label="Diet" className="flex flex-wrap gap-2">
      {DIETS.map((diet) => (
        <button
          key={diet.key}
          type="button"
          aria-pressed={active === diet.key}
          onClick={() => select(diet.key)}
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ring-1 transition-colors',
            active === diet.key
              ? 'bg-[var(--leaf-soft)] text-[var(--leaf-ink)] ring-leaf-500'
              : 'bg-[var(--surface)] text-[var(--text-muted)] ring-[var(--line)] hover:text-[var(--leaf-ink)]'
          )}
        >
          <span aria-hidden className={cn('size-2.5 rounded-full border', diet.dot)} />
          {diet.label}
        </button>
      ))}
    </div>
  );
}
