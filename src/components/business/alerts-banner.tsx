'use client';

import { useEffect, useState } from 'react';
import { disablePush, enablePush, readPushState, sendTestAlert, type PushState } from '@/lib/push/client';

/**
 * Shown on every console page until this device can receive new-order alerts with the site closed.
 * Owners without a laptop rely on this: the phone must be subscribed, or orders are missed.
 */
export function AlertsBanner() {
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    readPushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  async function turnOn() {
    setBusy(true);
    setNote('');
    const result = await enablePush();
    setState(result.state);
    if (result.error) setNote(result.error);
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    const result = await sendTestAlert();
    setNote(result.ok ? 'Test sent. Close this tab and check your phone in a few seconds.' : result.error);
    setBusy(false);
  }

  if (state === 'loading') return null;

  if (state === 'on') {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 pt-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm">
          <span className="font-bold text-[var(--leaf-ink)]">✓ Order alerts are on for this device, even when the site is closed.</span>
          <span className="flex gap-3">
            <button type="button" disabled={busy} onClick={test} className="font-bold underline">
              Send test
            </button>
            <button type="button" disabled={busy} onClick={async () => setState((await disablePush()).state)} className="text-[var(--text-muted)] underline">
              Turn off
            </button>
          </span>
          {note && <p className="w-full text-[var(--text-muted)]">{note}</p>}
        </div>
      </div>
    );
  }

  const help: Record<string, string> = {
    'install-first': 'On iPhone: tap Share, then "Add to Home Screen", then open Localty from the Home Screen and turn alerts on.',
    blocked: 'Alerts are blocked. Open your browser\'s site settings for this page and set Notifications to Allow, then reload.',
    unsupported: 'This browser cannot send alerts. Open the site in Chrome on your phone.',
    unconfigured: 'Alerts are not set up on the server yet. Please contact support.'
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-3 sm:px-6" role="alert">
      <div className="rounded-2xl border-2 border-[var(--leaf-ink)] bg-[var(--surface)] p-4">
        <p className="text-base font-extrabold">Turn on order alerts</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Get a phone alert the moment a customer places an order, even when this website is closed. Without it you must keep this page open all day.
        </p>
        {help[state] ? (
          <p className="mt-2 text-sm font-bold">{help[state]}</p>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={turnOn}
            className="mt-3 inline-flex h-11 items-center rounded-full bg-[var(--leaf-ink)] px-5 text-sm font-extrabold text-white"
          >
            {busy ? 'Turning on…' : 'Turn on alerts'}
          </button>
        )}
        {note && <p className="mt-2 text-sm text-red-700">{note}</p>}
      </div>
    </div>
  );
}
