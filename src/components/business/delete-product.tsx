'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

/** Removes a dish for good. To hide it for a while, use the in-stock switch on the menu instead. */
export function DeleteProduct({ productId, name }: { productId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    if (!window.confirm(`Delete "${name}" from your menu? To hide it for a while, mark it sold out instead.`)) return;
    setBusy(true);
    setError('');
    const result = await api('POST', `/v1/seller/products/${productId}/delete`);
    if (!result.ok) {
      setBusy(false);
      return setError(result.error);
    }
    router.push('/business/products');
    router.refresh();
  }

  return (
    <section className="grid gap-3 rounded-[22px] p-4 ring-1 ring-danger/30 sm:p-5">
      <div>
        <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">Remove from your menu</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">
          Deletes this product for good. Past orders keep their record. Only out for today? Switch it to sold out on
          your menu instead.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="justify-self-start border-danger/40 text-danger hover:border-danger hover:bg-danger/10 hover:text-danger"
        loading={busy}
        onClick={remove}
      >
        Delete this product
      </Button>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </section>
  );
}
