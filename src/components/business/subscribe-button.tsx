'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { approveMandate, callPaymentsApi } from '@/lib/payments/checkout';
import { Button } from '@/components/ui/button';

/** Sets up (or re-sets up) the monthly automatic payment, or cancels it. */
export function SubscribeButton({ label, cancel = false }: { label: string; cancel?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    if (cancel && !window.confirm('Stop automatic payment? You keep what you have already paid for.')) return;
    setBusy(true);
    setError('');
    if (cancel) {
      const response = await callPaymentsApi('/v1/seller/billing/cancel', {});
      const body = response ? ((await response.json().catch(() => ({}))) as { error?: string }) : {};
      if (!response?.ok) setError(body.error ?? 'Could not cancel. Try again in a moment.');
    } else {
      const result = await approveMandate();
      if (!result.ok && result.error) setError(result.error);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <Button type="button" variant={cancel ? 'outline' : 'leaf'} onClick={run} disabled={busy}>
        {busy ? 'Please wait…' : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
