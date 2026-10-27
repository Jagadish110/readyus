'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { friendlyError } from '@/lib/orders/errors';
import { Button } from '@/components/ui/button';

const FIELD =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-sm outline-none transition-all ' +
  'placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

export function DeliveryApplyForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState('Bike');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('Add your full name.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Add a 10-digit phone number.');

    setBusy(true);
    const result = await api('POST', '/v1/rider/apply', {
      fullName: name.trim(),
      phone: phone.trim(),
      vehicle: vehicle.trim()
    });
    setBusy(false);

    if (!result.ok) return setError(friendlyError(result.error));
    router.replace('/delivery');
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-3.5 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] sm:p-6"
    >
      <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" aria-label="Full name" autoComplete="name" />
      <input
        className={FIELD}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone number"
        aria-label="Phone number"
        inputMode="tel"
        autoComplete="tel"
      />
      <input className={FIELD} value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Vehicle (bike, cycle, scooter)" aria-label="Vehicle" />
      {error && (
        <p role="alert" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
          {error}
        </p>
      )}
      <Button type="submit" variant="leaf" size="lg" loading={busy}>
        Create delivery profile
      </Button>
    </form>
  );
}
