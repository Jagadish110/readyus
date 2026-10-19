import * as React from 'react';
import { cn } from '@/lib/utils';

/** `brand` marks a price or a discount; `leaf` marks everything structural. */
type Tone =
  | 'brand'
  | 'leaf'
  | 'leaf-soft'
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'glass';

const TONES: Record<Tone, string> = {
  brand: 'bg-linear-135 from-brand-500 to-brand-600 text-white shadow-[0_4px_12px_rgb(255_77_28/0.32)]',
  leaf: 'bg-leaf-600 text-white shadow-[0_4px_12px_rgb(36_101_64/0.28)]',
  'leaf-soft': 'bg-[var(--leaf-soft)] text-[var(--leaf-ink)] ring-1 ring-[var(--line)]',
  neutral: 'bg-[var(--surface-subtle)] text-[var(--text-muted)] ring-1 ring-[var(--line)]',
  success: 'bg-success/12 text-[var(--text)] ring-1 ring-success/35',
  warning: 'bg-warning/12 text-[var(--text)] ring-1 ring-warning/35',
  danger: 'bg-danger/12 text-[var(--text)] ring-1 ring-danger/35',
  glass: 'glass border border-white/40 text-white'
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: { tone?: Tone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.68rem] font-extrabold tracking-wide',
        TONES[tone],
        className
      )}
      {...props}
    />
  );
}

/** Green/red square used on Indian food listings. */
export function VegMark({ type }: { type: string }) {
  if (!type || type === '') return null;
  const isVeg = type === 'veg' || type === 'vegan' || type === 'jain';
  return (
    <span
      title={type}
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-[4px] border-[1.5px] bg-white',
        isVeg ? 'border-success' : 'border-danger'
      )}
    >
      <span className={cn('size-1.5 rounded-full', isVeg ? 'bg-success' : 'bg-danger')} />
    </span>
  );
}
