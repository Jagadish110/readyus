'use client';

import { cn } from '@/lib/utils';
import { useChangePulse } from './use-change-pulse';

/**
 * A number that rolls up when it grows and down when it shrinks, like a counter, so a tap on
 * + or − is visibly counted. It stays still when the page first loads. `children` is what to
 * show (for example a formatted price); `value` is the number that decides the direction.
 */
export function RollingNumber({
  value,
  className,
  children
}: {
  value: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const pulse = useChangePulse(value);
  return (
    <span
      key={pulse.count}
      className={cn('inline-block', pulse.count > 0 && (pulse.up ? 'animate-tick-up' : 'animate-tick-down'), className)}
    >
      {children ?? value}
    </span>
  );
}
