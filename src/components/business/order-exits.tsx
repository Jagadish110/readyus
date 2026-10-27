'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { friendlyError } from '@/lib/orders/errors';
import { timeAgo } from '@/lib/orders/status';
import { Button } from '@/components/ui/button';
import { formatPaise } from '@/lib/utils';

/** Small pieces the orders board uses for the ways an order can end badly. */

const CANCEL_REASONS = ['An item ran out', 'We are too busy', 'Kitchen problem', 'We have to close'];

const FAIL_CAUSES: Array<{ key: string; label: string; note: string }> = [
  { key: 'customer_unreachable', label: 'Customer not reachable', note: 'The customer is not refunded automatically' },
  { key: 'customer_refused', label: 'Customer refused it', note: 'The customer is not refunded automatically' },
  { key: 'wrong_address', label: 'Wrong address', note: 'The customer is not refunded automatically' },
  { key: 'rider_problem', label: 'Rider had a problem', note: 'The customer is refunded' },
  { key: 'shop_problem', label: 'Shop had a problem', note: 'The customer is refunded' }
];

type Run = (key: string, path: string, body: Record<string, unknown>) => Promise<void>;

/** "Cancel order": pick a reason, confirm. Offered until the rider has the food. */
export function CancelBox({ orderId, busy, run }: { orderId: string; busy: string; run: Run }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="justify-self-start text-danger" onClick={() => setOpen(true)}>
        Cancel this order
      </Button>
    );
  }
  return (
    <div className="grid gap-2 rounded-[18px] bg-[var(--tile)] p-3.5">
      <p className="text-sm font-bold">Why are you cancelling? The customer will see this, and any online payment is refunded.</p>
      <div className="flex flex-wrap gap-2">
        {CANCEL_REASONS.map((reason) => (
          <Button key={reason} size="sm" variant="outline" loading={busy === `cancel-${orderId}`} onClick={() => run(`cancel-${orderId}`, `/v1/seller/orders/${orderId}/cancel`, { reason })}>
            {reason}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Keep the order
        </Button>
      </div>
    </div>
  );
}

/** "Delivery failed": the cause decides whether the customer is refunded, so say so before the tap. */
export function FailBox({ orderId, busy, run }: { orderId: string; busy: string; run: Run }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="justify-self-start text-danger" onClick={() => setOpen(true)}>
        Delivery failed
      </Button>
    );
  }
  return (
    <div className="grid gap-2 rounded-[18px] bg-[var(--tile)] p-3.5">
      <p className="text-sm font-bold">What happened?</p>
      <ul className="grid gap-2">
        {FAIL_CAUSES.map((cause) => (
          <li key={cause.key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              <span className="block font-semibold">{cause.label}</span>
              <span className="block text-xs text-[var(--text-muted)]">{cause.note}</span>
            </span>
            <Button size="sm" variant="outline" loading={busy === `fail-${orderId}-${cause.key}`} onClick={() => run(`fail-${orderId}-${cause.key}`, `/v1/seller/orders/${orderId}/delivery-failed`, { cause: cause.key })}>
              Choose
            </Button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setOpen(false)}>
        Back
      </Button>
    </div>
  );
}

/** Return all or part of what the customer paid online, for example a missing item. */
export function RefundForm({ orderId, paidPaise, refundedPaise, targetPaise, onDone }: { orderId: string; paidPaise: number; refundedPaise: number; targetPaise: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const committed = Math.max(refundedPaise, targetPaise);
  const left = Math.max(0, paidPaise - committed);
  if (paidPaise <= 0) return null;

  if (left <= 0) {
    return <p className="text-xs font-semibold text-[var(--text-muted)]">Refunded {formatPaise(committed)} of {formatPaise(paidPaise)} paid online.</p>;
  }
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="leaf-outline" onClick={() => setOpen(true)}>
          Refund the customer
        </Button>
        {committed > 0 && <span className="text-xs font-semibold text-[var(--text-muted)]">{formatPaise(committed)} already refunded</span>}
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const paise = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paise) || paise <= 0) return setError('Enter an amount in rupees.');
    if (paise > left) return setError(`The most you can refund is ${formatPaise(left)}.`);
    setBusy(true);
    setError('');
    const result = await api('POST', `/v1/seller/orders/${orderId}/refund`, { amountPaise: paise, reason });
    setBusy(false);
    if (!result.ok) return setError(friendlyError(result.error));
    setOpen(false);
    setAmount('');
    setReason('');
    onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-[18px] bg-[var(--tile)] p-3.5" noValidate>
      <p className="text-sm font-bold">Refund up to {formatPaise(left)}</p>
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="Rupees" aria-label="Refund amount in rupees" className="h-11 rounded-[14px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-3.5 text-base outline-none focus:border-leaf-500" />
        <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder="Reason (the customer sees it)" aria-label="Reason for the refund" className="h-11 rounded-[14px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-3.5 text-base outline-none focus:border-leaf-500" />
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="leaf" loading={busy}>
          Send refund
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type Issue = { id: string; order_code: string; kind: string; message: string; status: 'open' | 'resolved'; created_at: string };

/** Problems customers reported on this shop's orders. */
export function IssuesList() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<{ issues: Issue[] }>('GET', '/v1/seller/issues');
    if (result.ok) setIssues(result.data.issues);
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function resolve(id: string) {
    setBusy(id);
    setError('');
    const result = await api('POST', `/v1/seller/issues/${id}/resolve`, { note: note[id] ?? '' });
    setBusy('');
    if (!result.ok) setError(friendlyError(result.error));
    await load();
  }

  const open = issues.filter((issue) => issue.status === 'open');
  if (open.length === 0) return null;

  return (
    <section className="grid gap-3">
      <h2 className="flex items-center gap-2 text-xs font-extrabold tracking-[0.16em] text-[var(--text-muted)] uppercase">
        Customer problems
        <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[0.65rem]">{open.length}</span>
      </h2>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      <ul className="grid gap-3">
        {open.map((issue) => (
          <li key={issue.id} className="grid gap-2.5 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-danger/30">
            <p className="font-display text-base font-extrabold tracking-[-0.025em]">
              {issue.order_code} <span className="text-sm font-semibold text-[var(--text-muted)]">· {issue.kind.replace(/_/g, ' ')} · {timeAgo(issue.created_at, Date.now())}</span>
            </p>
            {issue.message && <p className="text-sm">&ldquo;{issue.message}&rdquo;</p>}
            <div className="flex flex-wrap gap-2">
              <input value={note[issue.id] ?? ''} onChange={(event) => setNote((current) => ({ ...current, [issue.id]: event.target.value }))} maxLength={500} placeholder="What did you do? (the customer sees it)" aria-label="What you did about it" className="h-11 min-w-0 flex-1 rounded-[14px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-3.5 text-base outline-none focus:border-leaf-500" />
              <Button size="sm" variant="leaf" loading={busy === issue.id} onClick={() => resolve(issue.id)}>
                Mark resolved
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

type CashRow = { assignment_id: string; order_id: string; order_code: string; agent_id: string; rider_name: string; cash_paise: number; delivered_at: string };

/** Cash that riders collected and still have to give to the shop. */
export function CashPanel() {
  const [rows, setRows] = useState<CashRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<{ rows: CashRow[] }>('GET', '/v1/seller/cash');
    if (result.ok) setRows(result.data.rows);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(key: string, agentId: string, orderId?: string) {
    setBusy(key);
    setError('');
    const result = await api('POST', '/v1/seller/cash/confirm', { agentId, ...(orderId ? { orderId } : {}) });
    setBusy('');
    if (!result.ok) setError(friendlyError(result.error));
    await load();
  }

  if (!rows) return null;
  const riders = [...new Map(rows.map((row) => [row.agent_id, row.rider_name])).entries()];

  return (
    <section className="grid gap-4 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] sm:p-6">
      <div>
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Cash with your riders</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Cash customers paid on delivery. Tap &ldquo;Received&rdquo; when the rider hands it to you, so nothing goes missing.</p>
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      {riders.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nothing owed. Every cash order has been handed over.</p>
      ) : (
        riders.map(([agentId, name]) => {
          const mine = rows.filter((row) => row.agent_id === agentId);
          const total = mine.reduce((sum, row) => sum + row.cash_paise, 0);
          return (
            <div key={agentId} className="grid gap-2 rounded-[18px] bg-[var(--tile)] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  {name} <span className="font-extrabold text-brand-600">{formatPaise(total)}</span>
                </p>
                {mine.length > 1 && (
                  <Button size="sm" variant="leaf" loading={busy === `all-${agentId}`} onClick={() => confirm(`all-${agentId}`, agentId)}>
                    Received all {formatPaise(total)}
                  </Button>
                )}
              </div>
              <ul className="grid gap-1.5 text-sm">
                {mine.map((row) => (
                  <li key={row.assignment_id} className="flex items-center justify-between gap-2">
                    <span>
                      {row.order_code} <span className="text-[var(--text-muted)]">· {timeAgo(row.delivered_at, Date.now())}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-bold tabular-nums">{formatPaise(row.cash_paise)}</span>
                      <Button size="sm" variant="leaf-outline" loading={busy === row.assignment_id} onClick={() => confirm(row.assignment_id, agentId, row.order_id)}>
                        Received
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
