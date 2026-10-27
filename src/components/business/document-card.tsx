'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { uploadDocumentFile } from '@/lib/api/upload';
import type { DocumentKind, ShopDocument } from '@/lib/business/documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const FIELD =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-3.5 text-base outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

const BADGE = {
  pending: { tone: 'warning', label: 'Under review' },
  approved: { tone: 'success', label: 'Verified' },
  rejected: { tone: 'danger', label: 'Needs a fix' }
} as const;

type Props = {
  kind: DocumentKind;
  title: string;
  why: string;
  required: boolean;
  numberLabel: string;
  numberHint: string;
  numberPattern: string;
  needsExpiry: boolean;
  existing: ShopDocument | undefined;
};

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** One document: what it is for, where it stands, and a form to send or replace it. */
export function DocumentCard({ kind, title, why, required, numberLabel, numberHint, numberPattern, needsExpiry, existing }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(!existing || existing.status === 'rejected');
  const [number, setNumber] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const expired = Boolean(existing?.valid_until && new Date(existing.valid_until) < new Date(new Date().toDateString()));
  const badge = expired ? ({ tone: 'danger', label: 'Expired' } as const) : existing ? BADGE[existing.status] : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!file) return setError('Choose the certificate file (PDF or photo).');
    if (needsExpiry && !validUntil) return setError('Enter the expiry date shown on your certificate.');

    setBusy(true);
    const uploaded = await uploadDocumentFile(kind, file);
    if (!uploaded.ok) {
      setBusy(false);
      return setError(uploaded.error);
    }
    const saved = await api('POST', '/v1/seller/documents', {
      kind,
      number: number.trim(),
      path: uploaded.path,
      ...(needsExpiry ? { validUntil } : {})
    });
    setBusy(false);
    if (!saved.ok) return setError(saved.error);
    setOpen(false);
    setFile(null);
    router.refresh();
  }

  return (
    <Card className="grid gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">{title}</h2>
          <p className="text-xs font-bold tracking-[0.14em] text-[var(--text-muted)] uppercase">{required ? 'Required' : 'Optional'}</p>
        </div>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>

      <p className="text-sm leading-relaxed text-[var(--text-muted)]">{why}</p>

      {existing && (
        <dl className="grid gap-1 rounded-[18px] bg-[var(--tile)] p-3.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--text-muted)]">{numberLabel}</dt>
            <dd className="font-bold tabular-nums">{existing.number}</dd>
          </div>
          {existing.valid_until && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Valid until</dt>
              <dd className="font-bold">{dayLabel(existing.valid_until)}</dd>
            </div>
          )}
        </dl>
      )}

      {existing?.status === 'rejected' && existing.review_note && (
        <p className="rounded-[16px] bg-warning/12 px-4 py-3 text-sm font-medium ring-1 ring-warning/35">
          From the reviewer: {existing.review_note}
        </p>
      )}
      {existing?.status === 'pending' && (
        <p className="text-sm text-[var(--text-muted)]">We have your document. A reviewer usually checks it within a day, and you will get a notification.</p>
      )}

      {existing && !open && (
        <Button type="button" variant="leaf-outline" size="sm" className="justify-self-start" onClick={() => setOpen(true)}>
          {expired ? 'Upload renewed document' : 'Replace document'}
        </Button>
      )}

      {open && (
        <form onSubmit={submit} className="grid gap-3.5 border-t border-[var(--line)] pt-4" noValidate>
          <label className="grid content-start gap-1.5 text-sm font-bold">
            {numberLabel}
            <input
              className={FIELD}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              inputMode={kind === 'fssai' ? 'numeric' : 'text'}
              autoCapitalize="characters"
              maxLength={kind === 'fssai' ? 14 : 15}
              pattern={numberPattern}
              required
            />
            <span className="text-xs font-normal text-[var(--text-muted)]">{numberHint}</span>
          </label>

          {needsExpiry && (
            <label className="grid content-start gap-1.5 text-sm font-bold">
              Valid until
              <input className={FIELD} type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} required />
              <span className="text-xs font-normal text-[var(--text-muted)]">The expiry date printed on the certificate.</span>
            </label>
          )}

          <label className="grid content-start gap-1.5 text-sm font-bold">
            Certificate file
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full rounded-[16px] border-[1.5px] border-dashed border-[var(--line)] bg-[var(--surface)] p-3 text-sm font-normal file:mr-3 file:rounded-full file:border-0 file:bg-[var(--leaf-soft)] file:px-4 file:py-2 file:font-bold file:text-[var(--leaf-ink)]"
            />
            <span className="text-xs font-normal text-[var(--text-muted)]">PDF or clear photo, under 5 MB. Only our review team can open it.</span>
          </label>

          {error && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" variant="leaf" loading={busy}>
              {existing ? 'Send for review' : 'Submit'}
            </Button>
            {existing && (
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
