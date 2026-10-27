'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { disablePush, enablePush, readPushState, registerWorker, sendTestAlert, type PushState } from '@/lib/push/client';
import { timeAgo } from '@/lib/orders/status';
import { BellIcon } from '@/components/shell/icons';
import { cn } from '@/lib/utils';

type Item = { id: string; title: string; body: string; href: string | null; read_at: string | null; created_at: string };
type Pushed = { id?: string; title?: string; body?: string; href?: string };

const POLL_MS = 30_000;

/**
 * The bell: an inbox of every notification, an unread count, and the switch for pop-up alerts on
 * this device. The inbox is the dependable part (it is the same rows push is sent from); pop-ups are
 * a bonus that depends on the browser, so the bell never claims more than it can promise.
 */
export function NotificationCenter({ className }: { className?: string }) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [push, setPush] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<Pushed | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const result = await api<{ items: Item[]; unread: number }>('GET', '/v1/notifications');
    if (result.ok) {
      setItems(result.data.items);
      setUnread(result.data.unread);
    }
    setNow(Date.now());
  }, []);

  // Only for signed-in people; follows sign-in and sign-out without a reload.
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setSignedIn(Boolean(data.user)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session?.user)));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void load();
    readPushState().then(setPush).catch(() => setPush('unsupported'));

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);

    // The service worker tells open pages the moment an alert arrives, so the count and the toast do not wait for the poll.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'push') return;
      void load();
      setToast(event.data.payload as Pushed);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [signedIn, load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 7_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!signedIn) return null;

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    setNote('');
    if (next) {
      await load();
      // Keep the service worker registered even if alerts are off, so turning them on later is instant.
      if ('serviceWorker' in navigator) void registerWorker().catch(() => undefined);
    }
  }

  async function markAllRead() {
    setUnread(0);
    setItems((rows) => rows.map((row) => ({ ...row, read_at: row.read_at ?? new Date().toISOString() })));
    await api('POST', '/v1/notifications/read', { all: true });
  }

  async function openItem(item: Item) {
    setOpen(false);
    if (!item.read_at) {
      setUnread((count) => Math.max(0, count - 1));
      void api('POST', '/v1/notifications/read', { ids: [item.id] });
    }
    if (item.href) router.push(item.href);
  }

  async function turnOn() {
    setBusy(true);
    setNote('');
    const result = await enablePush();
    setPush(result.state);
    if (result.error) setNote(result.error);
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    setPush((await disablePush()).state);
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    const result = await sendTestAlert();
    setNote(result.ok ? 'Sent. It should appear in a few seconds.' : result.error);
    setBusy(false);
  }

  return (
    <div ref={box} className={cn('relative', className)}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative grid size-10 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] shadow-xs transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)]"
      >
        <BellIcon className="size-[19px]" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 grid min-w-[18px] place-items-center rounded-full border-2 border-[var(--surface)] bg-brand-500 px-1 text-[0.6rem] font-extrabold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {toast?.title && !open && (
        <button
          type="button"
          role="status"
          onClick={() => {
            setToast(null);
            if (toast.href) router.push(toast.href);
          }}
          className="animate-pop fixed inset-x-3 top-[84px] z-[60] grid gap-0.5 rounded-[20px] bg-[var(--surface)] px-4 py-3 text-left shadow-xl ring-1 ring-[var(--line)] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-80"
        >
          <span className="text-sm font-extrabold">{toast.title}</span>
          {toast.body && <span className="text-sm text-[var(--text-muted)]">{toast.body}</span>}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="animate-pop fixed inset-x-3 top-[84px] z-[60] grid max-h-[calc(100dvh-110px)] grid-rows-[auto_auto_1fr] overflow-hidden rounded-[26px] bg-[var(--surface)] shadow-xl ring-1 ring-[var(--line)] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[24rem]"
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Notifications</h2>
            {unread > 0 && (
              <button type="button" onClick={markAllRead} className="text-sm font-bold text-[var(--leaf-ink)] hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="px-4 pb-3">
            <AlertSetting state={push} busy={busy} note={note} onOn={turnOn} onOff={turnOff} onTest={test} />
          </div>

          <ul className="overflow-y-auto border-t border-[var(--line)]">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">Nothing yet. Updates about your orders will show up here.</li>}
            {items.map((item) => (
              <li key={item.id} className="border-b border-[var(--line)] last:border-b-0">
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--tile)]', !item.read_at && 'bg-[var(--leaf-soft)]/60')}
                >
                  <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.read_at ? 'bg-transparent' : 'bg-brand-500')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{item.title}</span>
                    {item.body && <span className="block text-sm text-[var(--text-muted)]">{item.body}</span>}
                    <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{timeAgo(item.created_at, now)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const STRIP = 'grid gap-2 rounded-[18px] bg-[var(--tile)] p-3 text-sm';
const LINK = 'w-fit text-sm font-bold text-[var(--leaf-ink)] hover:underline disabled:opacity-60';

/** The one line that tells the truth about pop-up alerts on this device, with the one action that fits. */
function AlertSetting({ state, busy, note, onOn, onOff, onTest }: { state: PushState; busy: boolean; note: string; onOn: () => void; onOff: () => void; onTest: () => void }) {
  if (state === 'loading' || state === 'unconfigured') return null;

  return (
    <div className={STRIP}>
      {state === 'off' && (
        <>
          <p className="font-semibold">Get an alert on this device, even when Localty is closed.</p>
          <button type="button" onClick={onOn} disabled={busy} className="inline-flex h-10 w-fit items-center rounded-full bg-leaf-600 px-4 text-sm font-bold text-white disabled:opacity-60">
            {busy ? 'Please wait…' : 'Turn on alerts'}
          </button>
        </>
      )}
      {state === 'on' && (
        <>
          <p className="font-semibold">Alerts are on for this device.</p>
          <span className="flex gap-4">
            <button type="button" onClick={onTest} disabled={busy} className={LINK}>
              Send a test
            </button>
            <button type="button" onClick={onOff} disabled={busy} className={LINK}>
              Turn off
            </button>
          </span>
        </>
      )}
      {state === 'blocked' && (
        <p>
          <span className="font-semibold">Alerts are blocked for this site.</span> To turn them on, open this site&rsquo;s settings in your browser (the lock
          or tune icon next to the address) and allow notifications. You will still see everything here.
        </p>
      )}
      {state === 'install-first' && (
        <p>
          <span className="font-semibold">To get alerts on iPhone or iPad,</span> tap Share, then &ldquo;Add to Home Screen&rdquo;, and open Localty from there.
          Until then, updates appear here.
        </p>
      )}
      {state === 'unsupported' && <p>This browser cannot show alerts. Updates still appear here, and you can use Chrome, Edge, Firefox or Safari for pop-ups.</p>}
      {note && <p className="text-[var(--text-muted)]">{note}</p>}
    </div>
  );
}
