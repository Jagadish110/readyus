'use client';

import { cn } from '@/lib/utils';
import { ACCEPT_WINDOW_SECONDS } from '@/lib/orders/status';
import { useSecondsLeft } from './countdown';

/**
 * The time the shop has left to accept, shown to the customer next to "Waiting for the shop".
 * Counts down every second and turns red in the last minute.
 */
export function AcceptTimer({
  deadline: given,
  placedAt,
  serverNow,
  className
}: {
  deadline: string | null | undefined;
  /** When the order was placed: the deadline is worked out from it if the server did not send one. */
  placedAt: string;
  serverNow?: string | null;
  className?: string;
}) {
  const deadline = given ?? new Date(new Date(placedAt).getTime() + ACCEPT_WINDOW_SECONDS * 1000).toISOString();
  const left = useSecondsLeft(deadline, serverNow);
  if (left === null) return null;

  const urgent = left <= 60;
  return (
    <p
      role="timer"
      aria-label={left > 0 ? `The shop has ${Math.ceil(left / 60)} ${left > 60 ? 'minutes' : 'minute'} left to accept` : 'Time to accept is up'}
      className={cn(
        'shrink-0 rounded-[18px] bg-[var(--surface)] px-4 py-2.5 text-center shadow-sm ring-1',
        urgent ? 'ring-danger/40' : 'ring-[var(--line)]',
        className
      )}
    >
      <span
        className={cn(
          'block font-display text-2xl leading-none font-extrabold tracking-[-0.04em] whitespace-nowrap tabular-nums',
          urgent && 'text-danger'
        )}
      >
        {left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Time up'}
      </span>
      <span className="mt-1 block text-xs font-semibold text-[var(--text-muted)]">{left > 0 ? 'to accept' : 'checking…'}</span>
    </p>
  );
}
