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
    <div className="grid gap-2 border-t border-[var(--line)] pt-4">
      <Button type="button" variant="ghost" size="sm" className="justify-self-start text-danger" loading={busy} onClick={remove}>
        Delete this product
      </Button>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}
