'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PAY_WINDOW_SECONDS } from '@/lib/orders/status';
import { payForOrder } from '@/lib/payments/checkout';
import { refreshWhenVisible } from '@/lib/refresh-when-visible';
import { Button } from '@/components/ui/button';
import { formatPaise } from '@/lib/utils';
import { Countdown, useSecondsLeft } from './countdown';

/** The time left and a Pay button on an Orders list card. The button opens Cashfree straight away. */
export function PayNow({
  orderId,
  totalPaise,
  placedAt,
  deadline,
  serverNow
}: {
  orderId: string;
  totalPaise: number;
  /** When the order was placed, already written for the customer. */
  placedAt: string;
  deadline?: string | null;
  serverNow?: string;
}) {
  const router = useRouter();
  const left = useSecondsLeft(deadline, serverNow);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pay() {
    setBusy(true);
    setError('');
    const result = await payForOrder(orderId);
    setBusy(false);
    // Paid, or this shop has to be paid by UPI instead: the order page takes it from here.
    if (result.ok || result.shopNotReady) {
      router.push(`/orders/${orderId}`);
      return;
    }
    if (!result.cancelled) setError(result.error);
    refreshWhenVisible(() => router.refresh());
  }

  return (
    <div className="mt-3.5 grid gap-3">
      {deadline && (
        <Countdown
          label="Time left to pay"
          left={left}
          totalSeconds={PAY_WINDOW_SECONDS}
          expired="Time is up. This order is being cancelled."
        />
      )}
      {error && (
        <p role="alert" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm">
          <span className="font-extrabold tabular-nums">{formatPaise(totalPaise)}</span>
          <span className="text-[var(--text-muted)]"> &middot; {placedAt}</span>
        </p>
        <Button size="sm" className="shrink-0 px-6" onClick={pay} loading={busy} disabled={left === 0}>
          Pay now
        </Button>
      </div>
    </div>
  );
}
