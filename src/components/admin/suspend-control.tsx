'use client';

import { useState } from 'react';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

const ERRORS: Record<string, string> = {
  REASON_REQUIRED: 'Give a short reason. The shop or rider will see it.',
  RIDER_HAS_ACTIVE_DELIVERY: 'This rider is on a delivery right now. Try again when it is done.',
  RIDER_NOT_FOUND: 'That rider cannot be changed any more. Refresh the list.',
  SELLER_NOT_FOUND: 'That shop no longer exists.'
};

/** Pause or restore a shop or rider. Pausing asks for a reason, which is shown to them. */
export function SuspendControl({
  path,
  suspended,
  onDone
}: {
  path: string;
  suspended: boolean;
  onDone: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(suspend: boolean) {
    setBusy(true);
    setError('');
    const result = await api('POST', path, { suspend, reason });
    setBusy(false);
    if (!result.ok) {
      setError(ERRORS[result.code ?? ''] ?? result.error);
      return;
    }
    setAsking(false);
    setReason('');
    onDone();
  }

  if (suspended) {
    return (
      <div>
        <Button size="sm" variant="leaf-outline" loading={busy} onClick={() => submit(false)}>
          Restore
        </Button>
        {error && <p role="alert" className="mt-1 text-xs font-semibold text-danger">{error}</p>}
      </div>
    );
  }

  if (!asking) {
    return (
      <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
        Pause
      </Button>
    );
  }

  return (
    <div className="grid gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        placeholder="Reason (they will see this)"
        aria-label="Reason for pausing"
        className="h-10 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 text-sm"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="danger" loading={busy} onClick={() => submit(true)}>
          Pause now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </div>
      {error && <p role="alert" className="text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}
