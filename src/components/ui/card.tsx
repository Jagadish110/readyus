import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The marketplace card: white on the cream page, generously rounded, held by a
 * hairline ring rather than a border. Matches the tiles on the landing page.
 */
export function Card({
  interactive,
  className,
  ...props
}: { interactive?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[26px] bg-[var(--surface)] shadow-sm ring-1 ring-[var(--line)]',
        'transition-[transform,box-shadow] duration-300 ease-[var(--ease-smooth)]',
        interactive &&
          'hover:-translate-y-1.5 hover:ring-leaf-400 hover:shadow-[0_22px_48px_rgb(28_22_20/0.12)]',
        className
      )}
      {...props}
    />
  );
}

/** Small capitalised label above a title. Leaf by default; brand on prices. */
export function Eyebrow({
  tone = 'leaf',
  className,
  ...props
}: { tone?: 'leaf' | 'brand' } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'text-eyebrow uppercase',
        tone === 'leaf' ? 'text-[var(--leaf-ink)]' : 'text-brand-600',
        className
      )}
      {...props}
    />
  );
}

export function SectionTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'font-display text-[clamp(1.35rem,2.6vw,1.75rem)] leading-[1.08] font-extrabold tracking-[-0.04em]',
        className
      )}
      {...props}
    />
  );
}
