'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { friendlyError } from '@/lib/orders/errors';
import { formatPaise } from '@/lib/utils';
import { useDirectory } from './use-directory';

type Row = {
  id: string;
  order_code: string;
  status: string;
  shop_name: string;
  customer_name: string | null;
  total_paise: number;
  refunded_paise: number;
  open_issues: number;
  created_at: string;
};

type Detail = {
  order: {
    id: string;
    order_code: string;
    status: string;
    payment_mode: string;
    total_paise: number;
    verified_prepaid_paise: number;
    refunded_paise: number;
    cash_collected_paise: number;
    cancel_reason: string;
    shop_name: string;
    shop_phone: string;
    customer_name: string | null;
    customer_phone: string | null;
  };
  items: { name: string; variant_label: string; quantity: number; line_total_paise: number }[];
  events: { status: string; note: string; at: string }[];
  issues: { id: string; kind: string; message: string; status: 'open' | 'resolved'; resolution_note: string }[];
  rider: { name: string; phone: string; status: string } | null;
};

const label = (s: string) => s.replaceAll('_', ' ');
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function OrdersDesk() {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [status, setStatus] = useState('');
  const { term, setTerm, rows, error, reload } = useDirectory<Row>('/v1/admin/orders', 'orders', `&status=${status}`);
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = onlyProblems ? rows?.filter((r) => r.open_issues > 0) : rows;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by order code, shop or customer"
          aria-label="Search orders"
          className="h-12 w-full rounded-full border border-[var(--line)] bg-[var(--surface)] px-5 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="h-12 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-sm"
        >
          <option value="">Any status</option>
          {['pending', 'accepted', 'preparing', 'packed', 'assigned', 'out_for_delivery', 'delivered', 'rejected', 'cancelled', 'cancelled_by_customer', 'delivery_failed', 'timed_out'].map((s) => (
            <option key={s} value={s}>{label(s)}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} className="size-4" />
        Only orders with an open customer problem
      </label>

      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      {shown?.length === 0 && <p className="text-sm text-[var(--text-muted)]">No orders match.</p>}

      {shown?.map((order) => (
        <Card key={order.id} className="grid gap-3 p-4">
          <button
            type="button"
            onClick={() => setOpenId(openId === order.id ? null : order.id)}
            aria-expanded={openId === order.id}
            className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
          >
            <span className="grid gap-0.5">
              <span className="font-display text-base font-extrabold tracking-[-0.02em]">{order.order_code}</span>
              <span className="text-sm text-[var(--text-muted)]">
                {order.shop_name} · {order.customer_name ?? 'Customer'} · {when(order.created_at)}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {order.open_issues > 0 && <Badge tone="danger">{order.open_issues} problem{order.open_issues > 1 ? 's' : ''}</Badge>}
              <Badge tone="neutral">{label(order.status)}</Badge>
              <span className="font-bold">{formatPaise(order.total_paise)}</span>
            </span>
          </button>
          {openId === order.id && <OrderDetail id={order.id} onChanged={reload} />}
        </Card>
      ))}
    </div>
  );
}

function OrderDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const result = await api<Detail>('GET', `/v1/admin/orders/${id}`);
    if (result.ok) setDetail(result.data);
    else setError(friendlyError(result.error));
  }, [id]);
  useEffect(() => void load(), [load]);

  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setError('');
    setMessage('');
    const result = await api('POST', path, body);
    setBusy(false);
    if (!result.ok) return setError(friendlyError(result.code ?? result.error));
    setMessage(done);
    await load();
    onChanged();
  }

  if (!detail) return <p className="text-sm text-[var(--text-muted)]">{error || 'Loading…'}</p>;
  const { order } = detail;
  const refundable = order.verified_prepaid_paise - order.refunded_paise;

  return (
    <div className="grid gap-4 border-t border-[var(--line)] pt-3 text-sm">
      <dl className="grid gap-1 rounded-[18px] bg-[var(--tile)] p-3.5">
        <Row k="Shop" v={`${order.shop_name} · ${order.shop_phone}`} />
        <Row k="Customer" v={`${order.customer_name ?? '—'}${order.customer_phone ? ` · ${order.customer_phone}` : ''}`} />
        <Row k="Rider" v={detail.rider ? `${detail.rider.name} · ${detail.rider.phone} (${detail.rider.status})` : 'None'} />
        <Row k="Paid online" v={formatPaise(order.verified_prepaid_paise)} />
        <Row k="Cash collected" v={formatPaise(order.cash_collected_paise)} />
        <Row k="Refunded" v={formatPaise(order.refunded_paise)} />
        {order.cancel_reason && <Row k="Reason it ended" v={order.cancel_reason} />}
      </dl>

      <ul className="grid gap-1">
        {detail.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>{item.quantity} × {item.name}{item.variant_label ? ` (${item.variant_label})` : ''}</span>
            <span>{formatPaise(item.line_total_paise)}</span>
          </li>
        ))}
      </ul>

      <ol className="grid gap-1 border-l-2 border-[var(--line)] pl-3">
        {detail.events.map((event, i) => (
          <li key={i}>
            <span className="font-bold">{label(event.status)}</span> <span className="text-[var(--text-muted)]">· {when(event.at)}{event.note ? ` · ${event.note}` : ''}</span>
          </li>
        ))}
      </ol>

      {detail.issues.length > 0 && (
        <div className="grid gap-2">
          <h3 className="font-bold">Customer problems</h3>
          {detail.issues.map((issue) => (
            <div key={issue.id} className="grid gap-2 rounded-[18px] bg-[var(--tile)] p-3.5">
              <p><Badge tone={issue.status === 'open' ? 'danger' : 'success'}>{issue.status}</Badge> <span className="font-bold">{label(issue.kind)}</span></p>
              {issue.message && <p>{issue.message}</p>}
              {issue.status === 'resolved' ? (
                issue.resolution_note && <p className="text-[var(--text-muted)]">Resolved: {issue.resolution_note}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <input
                    value={notes[issue.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [issue.id]: e.target.value })}
                    maxLength={300}
                    placeholder="What was done (customer sees this)"
                    aria-label="Resolution note"
                    className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4"
                  />
                  <Button size="sm" variant="leaf" loading={busy} onClick={() => act(`/v1/admin/issues/${issue.id}/resolve`, { note: notes[issue.id] ?? '' }, 'Marked resolved.')}>
                    Mark resolved
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {refundable > 0 && (
        <form
          className="grid gap-2 rounded-[18px] bg-[var(--tile)] p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            const paise = Math.round(Number(amount) * 100);
            if (!(paise > 0)) return setError('Enter an amount in rupees.');
            void act(`/v1/admin/orders/${id}/refund`, { amount_paise: paise, reason }, 'Refund requested. It reaches the customer within a few minutes.');
            setAmount('');
          }}
        >
          <h3 className="font-bold">Refund to the customer</h3>
          <p className="text-[var(--text-muted)]">Up to {formatPaise(refundable)} can still be refunded.</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="Amount in ₹"
              aria-label="Refund amount in rupees"
              className="h-10 w-32 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4"
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Reason"
              aria-label="Refund reason"
              className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4"
            />
            <Button size="sm" variant="danger" type="submit" loading={busy}>Refund</Button>
          </div>
        </form>
      )}

      {message && <p role="status" className="font-semibold text-[var(--leaf-ink)]">{message}</p>}
      {error && <p role="alert" className="font-semibold text-danger">{error}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--text-muted)]">{k}</dt>
      <dd className="text-right font-bold">{v}</dd>
    </div>
  );
}
