'use client';

import { useOptimistic, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const MODES = [
  { id: 'food', label: 'Food' },
  { id: 'items', label: 'Items' }
] as const;

/** Food vs everyday items. The two halves of the marketplace. */
export function ModeSwitch({ active }: { active: 'food' | 'items' }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The tapped side lights up at once; the page follows when it arrives.
  const [shown, setShown] = useOptimistic<string>(active);

  function select(mode: string) {
    const next = new URLSearchParams(params.toString());
    next.set('mode', mode);
    next.delete('category');
    startTransition(() => {
      setShown(mode);
      // 'nav-filter': same page, new content, so it crossfades (see RouteTransition).
      router.replace(`${pathname}?${next.toString()}`, { scroll: false, transitionTypes: ['nav-filter'] });
    });
  }

  return (
    <div
      aria-busy={pending}
      className="inline-flex gap-1 rounded-full border border-[var(--line)] bg-[var(--tile)] p-1 shadow-[inset_0_1px_3px_rgb(28_22_20/0.05)]"
    >
      {MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          onClick={() => select(mode.id)}
          aria-pressed={shown === mode.id}
          className={cn(
            'h-11 rounded-full px-6 text-sm font-bold transition-all duration-200 active:scale-[0.96]',
            shown === mode.id
              ? 'bg-[var(--surface)] text-[var(--leaf-ink)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            pending && shown === mode.id && 'animate-pulse'
          )}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
