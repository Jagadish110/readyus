'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api/client';
import { friendlyError } from '@/lib/orders/errors';
import { isEnded, timeAgo, type OrderStatus } from '@/lib/orders/status';
import { Button } from '@/components/ui/button';

const KINDS: Array<[string, string]> = [
  ['missing_item', 'An item is missing'],
  ['wrong_item', 'Wrong item'],
  ['quality', 'Food or item quality'],
  ['late', 'It is very late'],
  ['not_delivered', 'Marked delivered but I did not get it'],
  ['payment', 'A payment problem'],
  ['other', 'Something else']
];

type Issue = { id: string; kind: string; message: string; status: 'open' | 'resolved'; resolution_note: string; created_at: string };

/**
 * Everything a customer needs when something is not right: why an ended order ended, a way to call the
 * shop, a way to tell the shop and Localty what went wrong, and the receipt.
 */
export function OrderHelp({ orderId, status, shopPhone, cancelReason, paidOnline }: { orderId: string; status: OrderStatus; shopPhone: string | null; cancelReason: string; paidOnline: boolean }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const canReport = !['pending', 'payment_required', 'payment_rejected'].includes(status);

  const load = useCallback(async () => {
    const result = await api<{ issues: Issue[] }>('GET', `/v1/orders/${orderId}/issues`);
    if (result.ok) setIssues(result.data.issues);
  }, [orderId]);
  useEffect(() => {
    if (canReport) void load();
  }, [canReport, load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!kind) return setError('Choose what went wrong.');
    setBusy(true);
    setError('');
    const result = await api('POST', `/v1/orders/${orderId}/issue`, { kind, message });
    setBusy(false);
    if (!result.ok) return setError(friendlyError(result.error));
    setSent(true);
    setOpen(false);
    setKind('');
    setMessage('');
    await load();
  }

  const failed = status === 'delivery_failed' || status === 'cancelled' || status === 'rejected' || status === 'timed_out' || status === 'cancelled_by_customer';

  return (
    <section className="animate-rise grid gap-4 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)]">
      <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">Help with this order</h2>

      {isEnded(status) && cancelReason && (
        <p className="rounded-[16px] bg-[var(--tile)] px-4 py-3 text-sm">
          <span className="block text-xs font-extrabold tracking-[0.14em] text-[var(--text-muted)] uppercase">Why it ended</span>
          {cancelReason}
          {paidOnline && status !== 'delivery_failed' && failed && <span className="mt-1 block text-[var(--text-muted)]">Your online payment is refunded to the account you paid from.</span>}
          {paidOnline && status === 'delivery_failed' && <span className="mt-1 block text-[var(--text-muted)]">This was not refunded automatically. If that is wrong, report a problem below and we will look at it.</span>}
        </p>
      )}

      <div className="flex flex-wrap gap-2.5">
        {shopPhone && (
          <a href={`tel:${shopPhone}`} className="inline-flex h-11 items-center rounded-full border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-bold text-[var(--leaf-ink)] hover:border-leaf-500">
            Call the shop
          </a>
        )}
        {canReport && !open && (
          <Button size="sm" variant="outline" onClick={() => { setOpen(true); setSent(false); }}>
            Report a problem
          </Button>
        )}
        <Link href={`/orders/${orderId}/receipt`} className="inline-flex h-11 items-center rounded-full border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-5 text-sm font-bold hover:border-leaf-500">
          Receipt
        </Link>
      </div>

      {sent && <p role="status" className="text-sm font-semibold text-[var(--leaf-ink)]">Sent. The shop and our team have been told.</p>}

      {open && (
        <form onSubmit={submit} className="grid gap-3 rounded-[18px] bg-[var(--tile)] p-3.5" noValidate>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-bold">What went wrong?</legend>
            {KINDS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2.5 text-sm">
                <input type="radio" name="kind" value={key} checked={kind === key} onChange={() => setKind(key)} className="size-4 accent-[var(--leaf-ink)]" />
                {label}
              </label>
            ))}
          </fieldset>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} rows={3} placeholder="Tell us more (optional)" aria-label="Tell us more" className="w-full resize-none rounded-[14px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] p-3 text-sm outline-none focus:border-leaf-500" />
          {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="leaf" loading={busy}>Send</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}

      {issues.length > 0 && (
        <ul className="grid gap-2 text-sm">
          {issues.map((issue) => (
            <li key={issue.id} className="rounded-[16px] bg-[var(--tile)] px-4 py-3">
              <p className="font-semibold">
                {KINDS.find(([key]) => key === issue.kind)?.[1] ?? issue.kind}
                <span className="font-normal text-[var(--text-muted)]"> · {issue.status === 'open' ? 'waiting for the shop' : 'resolved'} · {timeAgo(issue.created_at, Date.now())}</span>
              </p>
              {issue.status === 'resolved' && issue.resolution_note && <p className="text-[var(--text-muted)]">Shop: {issue.resolution_note}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
