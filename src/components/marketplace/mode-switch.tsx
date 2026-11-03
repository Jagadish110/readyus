'use client';

import { useOptimistic, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const MODES = [
  { id: 'food', label: 'Food' },
  { id: 'items', label: 'Items' }
] as const;

/** Food vs everyday items. The two halves of the marketplace. A white thumb slides to the chosen side. */
export function ModeSwitch({ active, onDark }: { active: 'food' | 'items'; onDark?: boolean }) {
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
      className={cn(
        'relative inline-grid shrink-0 grid-cols-2 rounded-full border p-1',
        onDark
          ? 'border-white/15 bg-white/12'
          : 'border-[var(--line)] bg-[var(--tile)] shadow-[inset_0_1px_3px_rgb(28_22_20/0.05)]'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full shadow-sm transition-transform duration-300 ease-[var(--ease-smooth)]',
          onDark ? 'bg-white' : 'bg-[var(--surface)]',
          shown === 'items' && 'translate-x-full'
        )}
      />
      {MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          onClick={() => select(mode.id)}
          aria-pressed={shown === mode.id}
          className={cn(
            'relative h-11 rounded-full px-5 text-sm font-bold transition-[color,transform] duration-200 active:scale-[0.96] sm:px-6',
            shown === mode.id
              ? onDark
                ? 'text-leaf-700'
                : 'text-[var(--leaf-ink)]'
              : onDark
                ? 'text-white/85 hover:text-white'
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
