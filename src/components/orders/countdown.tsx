'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Whole seconds until `deadline`, updated every second; null until the page has loaded in the browser.
 * `serverNow` is the server's clock from the same answer: a phone set to the wrong time would otherwise show the
 * wrong countdown. Only the first one counts, so the timer does not wobble with each poll's network delay.
 */
export function useSecondsLeft(deadline: string | null | undefined, serverNow?: string | null) {
  const clockGap = useRef<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (clockGap.current === null && serverNow) clockGap.current = new Date(serverNow).getTime() - Date.now();
    if (!deadline) {
      setLeft(null);
      return;
    }
    const end = new Date(deadline).getTime();
    const tick = () => setLeft(Math.max(0, Math.ceil((end - (Date.now() + (clockGap.current ?? 0))) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, serverNow]);

  return left;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

type Props = {
  /** What the clock is counting towards, such as "Time to accept". */
  label: string;
  left: number | null;
  /** The full length of the wait, so the bar can show how much of it is left. */
  totalSeconds: number;
  /** Said once the time has run out. */
  expired: string;
};

/** A countdown with a draining bar. It turns amber in the last two minutes and red in the last. */
export function Countdown({ label, left, totalSeconds, expired }: Props) {
  // Holds its height while loading, so the card does not jump.
  if (left === null) return <div aria-hidden className="h-[4.25rem] rounded-[16px] bg-[var(--tile)]" />;

  if (left === 0) {
    return (
      <p role="status" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-bold text-[var(--text)] ring-1 ring-danger/30">
        {expired}
      </p>
    );
  }

  const urgent = left <= 60;
  const soon = left <= 120;
  return (
    <div
      role="timer"
      aria-label={`${label}: ${Math.ceil(left / 60)} ${left > 60 ? 'minutes' : 'minute'} left`}
      className={cn(
        'rounded-[16px] px-4 py-2.5 text-[var(--text)] ring-1',
        urgent ? 'bg-danger/10 ring-danger/30' : soon ? 'bg-warning/15 ring-warning/35' : 'bg-[var(--tile)] ring-[var(--line)]'
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-bold">{label}</span>
        <span className={cn('font-display text-2xl leading-tight font-extrabold tabular-nums', urgent && 'animate-pulse text-danger')}>
          {clock(left)}
        </span>
      </div>
      <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-300/30">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-1000 ease-linear',
            urgent ? 'bg-danger' : soon ? 'bg-warning' : 'bg-leaf-600'
          )}
          style={{ width: `${Math.min(100, (left / totalSeconds) * 100)}%` }}
        />
      </div>
    </div>
  );
}
