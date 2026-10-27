'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import type { ShopRow } from '@/lib/business/db';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const fieldClass =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-base outline-none transition-all focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

export function ShopControls({ shop }: { shop: ShopRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(shop.business_open);
  const [auto, setAuto] = useState(shop.auto_accept);
  const [radius, setRadius] = useState(String(Number(shop.service_radius_km)));
  const [openTime, setOpenTime] = useState(shop.open_time);
  const [closeTime, setCloseTime] = useState(shop.close_time);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const approved = shop.status === 'approved';

  async function save(values: Record<string, unknown>, done: string) {
    const result = await api('POST', '/v1/seller/shop/settings', values);
    if (!result.ok) return setMessage({ tone: 'error', text: result.error });
    setMessage({ tone: 'ok', text: done });
    router.refresh();
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    startTransition(() => {
      void save({ business_open: next }, next ? 'You are open for orders.' : 'You are closed.');
    });
  }

  function toggleAuto() {
    const next = !auto;
    setAuto(next);
    startTransition(() => {
      void save({ auto_accept: next }, next ? 'New orders are now accepted for you.' : 'You will accept each order yourself.');
    });
  }

  function saveSettings() {
    const km = Number(radius);
    if (!Number.isFinite(km) || km <= 0 || km > 50) {
      return setMessage({ tone: 'error', text: 'Delivery radius must be between 0.5 and 50 km.' });
    }
    if (!openTime || !closeTime) {
      return setMessage({ tone: 'error', text: 'Set both opening and closing time.' });
    }
    startTransition(() => {
      void save({ service_radius_km: km, open_time: openTime, close_time: closeTime }, 'Shop settings saved.');
    });
  }

  return (
    <Card className="grid gap-5 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Taking orders</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {approved ? 'Close the shop when you need a break.' : 'Available once your shop is approved.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={open}
          aria-label="Open for orders"
          disabled={!approved || pending}
          onClick={toggleOpen}
          className={cn(
            'relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50',
            open ? 'bg-leaf-600' : 'bg-ink-300'
          )}
        >
          <span
            className={cn(
              'absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform',
              open && 'translate-x-6'
            )}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-extrabold tracking-[-0.03em]">Accept orders automatically</h2>
          <p className="text-sm text-[var(--text-muted)]">
            New orders are accepted the moment they arrive (online orders once paid). Use it only if you can always make what is on your menu.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          aria-label="Accept orders automatically"
          disabled={!approved || pending}
          onClick={toggleAuto}
          className={cn('relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50', auto ? 'bg-leaf-600' : 'bg-ink-300')}
        >
          <span className={cn('absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform', auto && 'translate-x-6')} />
        </button>
      </div>

      <hr className="border-[var(--line)]" />

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          saveSettings();
        }}
      >
        <label className="grid gap-1.5 text-sm font-bold">
          Delivery radius (km)
          <input
            className={fieldClass}
            type="number"
            inputMode="decimal"
            min={0.5}
            max={50}
            step={0.5}
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
          />
          <span className="text-xs font-medium text-[var(--text-muted)]">
            Customers farther than this from your pin will not see your shop.
          </span>
        </label>
        <p className="text-xs font-medium text-[var(--text-muted)]">
          Opening hours are India time. Outside them your shop shows as closed and cannot take orders, even with the switch above on.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-sm font-bold">
            Opens
            <input className={fieldClass} type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Closes
            <input className={fieldClass} type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="leaf" size="sm" loading={pending}>
            Save settings
          </Button>
          {message && (
            <p
              role="status"
              className={cn('text-sm font-semibold', message.tone === 'ok' ? 'text-[var(--leaf-ink)]' : 'text-danger')}
            >
              {message.text}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
