'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api/client';
import {
  onSoundEnabledChange,
  soundEnabled,
  soundReady,
  startRinging,
  stopRinging,
  unlockSound
} from '@/lib/orders/order-sound';

type Waiting = { id: string; order_code: string };

const REPORTED = 'localty:orders-waiting';
const CHECK_MS = 5_000;

/**
 * The orders board already reads every order every few seconds, so it passes on which ones are waiting.
 * The alarm then hears a decision the moment it is made, and does not ask the server the same question twice.
 */
export function reportWaiting(waiting: Waiting[]) {
  window.dispatchEvent(new CustomEvent(REPORTED, { detail: waiting }));
}

/**
 * Rings on every page of the shop console while an order is waiting to be accepted or declined,
 * and goes quiet only when none is left (accepted, declined, cancelled or timed out).
 */
export function OrderAlarm() {
  const pathname = usePathname();
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const reportedAt = useRef(0);

  const check = useCallback(async () => {
    const result = await api<{ waiting: Waiting[] }>('GET', '/v1/seller/orders/waiting');
    // A failed check (no connection, signed out) changes nothing: a ring in progress keeps going.
    if (result.ok) setWaiting(result.data.waiting);
  }, []);

  useEffect(() => {
    setEnabled(soundEnabled());
    setReady(soundReady());
    return onSoundEnabledChange(setEnabled);
  }, []);

  // Keeps checking in a background tab too: that is exactly when the ring is needed.
  useEffect(() => {
    void check();
    const timer = window.setInterval(() => {
      // While the orders board is reporting, its news is fresher than a check would be.
      if (Date.now() - reportedAt.current > CHECK_MS * 2) void check();
    }, CHECK_MS);
    const onReported = (event: Event) => {
      reportedAt.current = Date.now();
      setWaiting((event as CustomEvent<Waiting[]>).detail);
    };
    const onVisible = () => document.visibilityState === 'visible' && void check();
    // A push reaches the open page before the next check would.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'push') void check();
    };
    window.addEventListener(REPORTED, onReported);
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(REPORTED, onReported);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [check]);

  // Browsers allow sound only after a tap or key press on the page, so the first one switches it on.
  useEffect(() => {
    if (ready) return;
    const unlock = () => void unlockSound().then((ok) => ok && setReady(true));
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [ready]);

  const count = waiting.length;
  useEffect(() => {
    if (count > 0 && enabled && ready) startRinging();
    else stopRinging();
  }, [count, enabled, ready]);

  // Leaving the console (or signing out) must never leave a ring behind.
  useEffect(() => stopRinging, []);

  if (count === 0) return null;

  const onOrdersPage = pathname === '/business/orders';
  const silent = enabled && !ready;
  // On the orders page the order itself is on screen; only say something if the ring cannot be heard.
  if (onOrdersPage && !silent) return null;

  return (
    <div role="alert" className="bg-brand-500 text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm font-bold sm:px-6">
        <span>
          {count === 1 ? `New order ${waiting[0]!.order_code} is waiting.` : `${count} new orders are waiting.`}{' '}
          {silent ? 'Tap anywhere to hear the ring.' : 'Accept or decline to stop the ring.'}
        </span>
        {!onOrdersPage && (
          <Link href="/business/orders" className="rounded-full bg-white px-4 py-1.5 font-extrabold text-brand-600">
            Open orders
          </Link>
        )}
      </div>
    </div>
  );
}
