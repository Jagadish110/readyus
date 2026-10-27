'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Doc = {
  kind: 'fssai' | 'gst';
  number: string;
  valid_until: string | null;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string;
  url: string | null;
  isPdf: boolean;
};

const LABEL = { fssai: 'FSSAI licence', gst: 'GST registration' } as const;
const TONE = { pending: 'warning', approved: 'success', rejected: 'danger' } as const;

/** A shop's FSSAI and GST documents, with the file to look at and approve / reject buttons. */
export function ShopDocuments({ sellerId, foodShop, onChange }: { sellerId: string; foodShop: boolean; onChange?: () => void }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    const result = await api<{ documents: Doc[] }>('GET', `/v1/admin/sellers/${sellerId}/documents`);
    if (result.ok) setDocs(result.data.documents);
    else setError(result.error);
  }, [sellerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(kind: string, approve: boolean) {
    setBusy(kind);
    setError('');
    const result = await api('POST', `/v1/admin/sellers/${sellerId}/documents/${kind}`, { approve, note: approve ? '' : note.trim() });
    setBusy('');
    if (!result.ok) return setError(result.error);
    setRejecting(null);
    setNote('');
    await load();
    onChange?.();
  }

  const expired = (doc: Doc) => Boolean(doc.valid_until && new Date(doc.valid_until) < new Date(new Date().toDateString()));

  return (
    <div className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4">
      <h3 className="text-xs font-bold tracking-[0.14em] text-[var(--text-muted)] uppercase">Documents</h3>

      {!docs && !error && <div className="skeleton h-16 rounded-[18px]" />}
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}

      {docs && docs.length === 0 && (
        <p className="rounded-[16px] bg-warning/12 px-4 py-3 text-sm font-medium ring-1 ring-warning/35">
          {foodShop ? 'No documents yet. A food shop cannot be approved without an FSSAI licence.' : 'No documents sent. None are required for this kind of shop.'}
        </p>
      )}

      {docs?.map((doc) => (
        <div key={doc.kind} className="grid gap-2 rounded-[18px] bg-[var(--tile)] p-3.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{LABEL[doc.kind]}</strong>
            <Badge tone={expired(doc) ? 'danger' : TONE[doc.status]}>{expired(doc) ? 'Expired' : doc.status}</Badge>
          </div>
          <p className="tabular-nums">
            {doc.number}
            {doc.valid_until && <span className="text-[var(--text-muted)]"> · valid until {new Date(doc.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          </p>
          {doc.url ? (
            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="w-fit font-bold text-[var(--leaf-ink)] underline">
              Open the {doc.isPdf ? 'PDF' : 'photo'} (link works for 5 minutes)
            </a>
          ) : (
            <p className="text-[var(--text-muted)]">The file could not be opened.</p>
          )}
          <p className="text-xs text-[var(--text-muted)]">
            Check: the name on the certificate matches the shop or owner, the number matches what was typed, and the expiry date is in the future.
          </p>
          {doc.status === 'rejected' && doc.review_note && <p className="text-xs">Note sent to owner: {doc.review_note}</p>}

          {rejecting === doc.kind ? (
            <div className="grid gap-2">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={300}
                placeholder="What should the owner fix?"
                className="h-11 w-full rounded-[14px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-3.5 text-sm outline-none focus:border-leaf-500"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="danger" loading={busy === doc.kind} onClick={() => decide(doc.kind, false)}>
                  Reject document
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                  Back
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="leaf" loading={busy === doc.kind} disabled={doc.status === 'approved'} onClick={() => decide(doc.kind, true)}>
                {doc.status === 'approved' ? 'Approved' : 'Approve document'}
              </Button>
              <Button size="sm" variant="leaf-outline" disabled={busy === doc.kind} onClick={() => setRejecting(doc.kind)}>
                Reject
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
