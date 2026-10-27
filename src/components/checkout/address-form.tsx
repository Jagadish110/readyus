'use client';

import { useState } from 'react';
import { api } from '@/lib/api/client';
import type { LatLng } from '@/lib/orders/geo';
import { PinPicker } from '@/components/maps/pin-picker';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type AddressRow = {
  id: string;
  label: string;
  recipient: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  pincode: string;
  location: unknown;
  is_default: boolean;
};

const LABELS = ['Home', 'Work', 'Other'] as const;

const FIELD =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-sm outline-none transition-all ' +
  'placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

type Props = {
  /** Where the map opens; usually the pin the customer browsed from. */
  startPin: LatLng | null;
  makeDefault: boolean;
  onSaved: (address: AddressRow) => void;
  onCancel?: () => void;
};

export function AddressForm({ startPin, makeDefault, onSaved, onCancel }: Props) {
  const [label, setLabel] = useState<(typeof LABELS)[number]>('Home');
  const [recipient, setRecipient] = useState('');
  const [phone, setPhone] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [pin, setPin] = useState<LatLng | null>(startPin);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function useMyLocation() {
    setError('');
    if (!navigator.geolocation) {
      setError('This browser cannot share a location. Drag the pin instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError('We could not read your location. Allow location access or drag the pin.');
      },
      { enableHighAccuracy: true, timeout: 12_000 }
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    if (!pin) return setError('Set the pin for your door first, using your location or the map.');
    if (line1.trim().length < 3) return setError('Add your flat, house or building and street.');
    if (phone.replace(/\D/g, '').length < 10) return setError('Add a 10-digit phone number so the rider can reach you.');

    setSaving(true);
    const result = await api<{ address: AddressRow }>('POST', '/v1/addresses', {
      label,
      recipient: recipient.trim(),
      phone: phone.trim(),
      line1: line1.trim(),
      line2: line2.trim(),
      landmark: landmark.trim(),
      city: city.trim(),
      pincode: pincode.trim(),
      lat: pin.lat,
      lng: pin.lng,
      makeDefault
    });
    setSaving(false);

    if (!result.ok) return setError(result.error || 'Could not save this address. Please try again.');
    const saved = result.data.address;
    onSaved(saved);
  }

  return (
    <form onSubmit={save} className="mt-4 grid gap-3.5">
      <div className="flex gap-2" role="group" aria-label="Address type">
        {LABELS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setLabel(option)}
            aria-pressed={label === option}
            className={cn(
              'rounded-full px-4 py-2 text-sm font-bold ring-1 transition-colors',
              label === option
                ? 'bg-[var(--leaf-soft)] text-[var(--leaf-ink)] ring-leaf-500'
                : 'bg-[var(--surface)] text-[var(--text-muted)] ring-[var(--line)] hover:text-[var(--text)]'
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className={FIELD}
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="Name of who will receive"
          autoComplete="name"
        />
        <input
          className={FIELD}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Phone number"
          inputMode="tel"
          autoComplete="tel"
        />
      </div>
      <input
        className={FIELD}
        value={line1}
        onChange={(event) => setLine1(event.target.value)}
        placeholder="Flat / house no., building, street"
        autoComplete="address-line1"
        required
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className={FIELD}
          value={line2}
          onChange={(event) => setLine2(event.target.value)}
          placeholder="Area (optional)"
          autoComplete="address-line2"
        />
        <input
          className={FIELD}
          value={landmark}
          onChange={(event) => setLandmark(event.target.value)}
          placeholder="Landmark (optional)"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          className={FIELD}
          value={city}
          onChange={(event) => setCity(event.target.value)}
          placeholder="City"
          autoComplete="address-level2"
        />
        <input
          className={FIELD}
          value={pincode}
          onChange={(event) => setPincode(event.target.value)}
          placeholder="Pincode"
          inputMode="numeric"
          autoComplete="postal-code"
        />
      </div>

      <div className="grid gap-2.5">
        <Button type="button" variant="leaf-outline" size="sm" onClick={useMyLocation} loading={locating}>
          {pin ? 'Update from my current location' : 'Use my current location'}
        </Button>
        {pin && <PinPicker value={pin} onChange={setPin} />}
      </div>

      {error && (
        <p role="alert" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" variant="leaf" loading={saving}>
          Save address
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
