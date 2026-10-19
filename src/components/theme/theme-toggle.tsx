'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'readyus-theme';
/** Fired on every change so a second toggle on the page stays in step. */
const SYNC_EVENT = 'readyus-theme-change';

export type ThemeChoice = 'light' | 'dark' | 'system';

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: React.ReactNode }> = [
  {
    value: 'light',
    label: 'Light',
    icon: (
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="10" cy="10" r="3.6" />
        <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.4 4.4l1.4 1.4M14.2 14.2l1.4 1.4M15.6 4.4l-1.4 1.4M5.8 14.2l-1.4 1.4" strokeLinecap="round" />
      </svg>
    )
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: (
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M16.5 11.8A7 7 0 0 1 8.2 3.5a7 7 0 1 0 8.3 8.3Z" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    value: 'system',
    label: 'System',
    icon: (
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <rect x="2.5" y="4" width="15" height="10" rx="2" />
        <path d="M7 17h6" strokeLinecap="round" />
      </svg>
    )
  }
];

/** Applies a choice to the document the same way the pre-paint script does. */
function applyTheme(choice: ThemeChoice) {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (dark) {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
}

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return 'system';
}

/**
 * Light / dark / system switch.
 *
 * The choice is kept in localStorage under the same key the inline script in
 * the root layout reads before paint, so a reload never flashes the wrong
 * theme. "System" keeps following the OS for as long as it stays selected.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = React.useState<ThemeChoice>('system');
  const [ready, setReady] = React.useState(false);

  // Read the stored choice after mount: the server has no way to know it, and
  // rendering it directly would mismatch during hydration.
  React.useEffect(() => {
    setChoice(readStored());
    setReady(true);
  }, []);

  // Another toggle elsewhere on the page changed the theme.
  React.useEffect(() => {
    const onSync = (event: Event) => setChoice((event as CustomEvent<ThemeChoice>).detail);
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);

  // While on "system", track the OS preference as it changes.
  React.useEffect(() => {
    if (choice !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  function select(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember it should not stop the switch working.
    }
    window.dispatchEvent(new CustomEvent<ThemeChoice>(SYNC_EVENT, { detail: next }));
  }

  const index = OPTIONS.findIndex((option) => option.value === choice);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        'relative inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 shadow-xs',
        className
      )}
    >
      {/* Sliding indicator: one element that moves, so the switch feels physical. */}
      <span
        aria-hidden
        className={cn(
          'absolute top-1 bottom-1 left-1 w-9 rounded-full bg-leaf-600 shadow-[0_4px_12px_rgb(36_101_64/0.32)]',
          'transition-[transform,opacity] duration-300 ease-[var(--ease-spring)]',
          ready ? 'opacity-100' : 'opacity-0'
        )}
        style={{ transform: 'translateX(' + index * 36 + 'px)' }}
      />

      {OPTIONS.map((option) => {
        const selected = ready && option.value === choice;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => select(option.value)}
            className={cn(
              'relative z-1 grid size-9 place-items-center rounded-full transition-colors duration-200',
              selected ? 'text-white' : 'text-[var(--text-muted)] hover:text-[var(--leaf-ink)]'
            )}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
