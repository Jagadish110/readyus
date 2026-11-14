'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { useLocation } from '@/lib/state/location';
import { AddressForm } from '@/components/checkout/address-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Address = { id: string; label: string; recipient: string; phone: string; line1: string; line2: string; landmark: string; city: string; pincode: string; is_default: boolean };

/** The addresses a customer has saved: add one (with its map pin), choose the usual one, or remove one. */
export function AddressBook() {
  const { location } = useLocation();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const result = await api<{ addresses: Address[] }>('GET', '/v1/addresses');
    if (result.ok) setAddresses(result.data.addresses);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, path: string) {
    if (path.endsWith('/delete') && !window.confirm('Remove this address?')) return;
    setBusy(key);
    setError('');
    const result = await api('POST', path);
    setBusy('');
    if (!result.ok) setError(result.error);
    await load();
  }

  return (
    <section className="animate-rise grid gap-3 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] sm:p-6">
      <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Saved addresses</h2>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
      {addresses === null ? (
        <div className="skeleton h-16 rounded-[18px]" />
      ) : addresses.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          None yet. Add one below, with its map pin, so checkout is quicker.
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {addresses.map((address) => (
            <li key={address.id} className="grid gap-1.5 rounded-[18px] bg-[var(--tile)] p-3.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  {address.label || 'Address'} <span className="font-medium text-[var(--text-muted)]">· {address.recipient}</span>
                </p>
                {address.is_default && <Badge tone="leaf-soft">Default</Badge>}
              </div>
              <p className="text-[var(--text-muted)]">{[address.line1, address.line2, address.landmark, address.city, address.pincode].filter(Boolean).join(', ')}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {!address.is_default && (
                  <Button size="sm" variant="leaf-outline" loading={busy === `d-${address.id}`} onClick={() => act(`d-${address.id}`, `/v1/addresses/${address.id}/default`)}>
                    Make default
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-danger" loading={busy === `x-${address.id}`} onClick={() => act(`x-${address.id}`, `/v1/addresses/${address.id}/delete`)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        // The same form as checkout: the map starts where the customer is browsing from.
        <AddressForm
          startPin={location ? { lat: location.lat, lng: location.lng } : null}
          makeDefault={!addresses?.length}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button size="sm" variant="leaf-outline" className="w-fit" onClick={() => setAdding(true)}>
          + Add a new address
        </Button>
      )}
    </section>
  );
}
