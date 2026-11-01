'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import type { ShopRow } from '@/lib/business/db';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PinIcon } from '@/components/shell/icons';
import { cn } from '@/lib/utils';

const fieldClass =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-base outline-none transition-all focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

type Pin = { lat: number; lng: number } | null;

const mapsLink = (pin: { lat: number; lng: number }) => `https://www.google.com/maps?q=${pin.lat},${pin.lng}`;

/**
 * The shop's pin and address. The pin decides which customers can see the shop and how far a rider
 * rides, so the owner re-pins it standing at the shop's door.
 */
export function ShopLocation({ shop }: { shop: ShopRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState<Pin>(shop.lat !== null && shop.lng !== null ? { lat: Number(shop.lat), lng: Number(shop.lng) } : null);
  const [moved, setMoved] = useState(false);
  const [address, setAddress] = useState(shop.address);
  const [city, setCity] = useState(shop.city);
  const [pincode, setPincode] = useState(shop.pincode);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  function locate() {
    setMessage(null);
    if (!('geolocation' in navigator)) return setMessage({ tone: 'error', text: 'This device cannot share a location.' });
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setMoved(true);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setMessage({ tone: 'error', text: 'We could not read your location. Allow access and try again.' });
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  function save() {
    if (!pin) return setMessage({ tone: 'error', text: 'Pin your shop first: stand at the shop and tap Use my current location.' });
    if (address.trim().length < 5) return setMessage({ tone: 'error', text: 'Enter the shop address.' });
    if (!city.trim()) return setMessage({ tone: 'error', text: 'Enter the city.' });
    if (!/^\d{6}$/.test(pincode.trim())) return setMessage({ tone: 'error', text: 'Enter a 6-digit pincode.' });
    startTransition(async () => {
      const result = await api('POST', '/v1/seller/shop/location', {
        lat: pin.lat,
        lng: pin.lng,
        address: address.trim(),
        city: city.trim(),
        pincode: pincode.trim()
      });
      if (!result.ok) return setMessage({ tone: 'error', text: result.error });
      setMoved(false);
      setMessage({ tone: 'ok', text: 'Shop location saved.' });
      router.refresh();
    });
  }

  return (
    <Card className="grid gap-5 p-5 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Shop location</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Customers within your delivery radius of this pin can see you. Stand at your shop to set it exactly.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--leaf-soft)] p-3.5 ring-1 ring-[var(--line)]">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--surface)] text-[var(--leaf-ink)]">
          <PinIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{pin ? (moved ? 'New pin, not saved yet' : 'Shop pinned') : 'No pin yet'}</p>
          {pin ? (
            <a
              href={mapsLink(pin)}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-[var(--leaf-ink)] underline underline-offset-2"
            >
              {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)} · Open in Maps
            </a>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">Customers cannot find you until the shop is pinned.</p>
          )}
        </div>
        <Button type="button" variant="leaf-outline" size="sm" loading={locating} onClick={locate} className="shrink-0">
          Use my current location
        </Button>
      </div>

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="grid gap-1.5 text-sm font-bold">
          Shop address
          <input
            className={fieldClass}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Shop no., street, area"
            autoComplete="off"
          />
        </label>
        <div className="grid grid-cols-[1fr_7.5rem] gap-3">
          <label className="grid gap-1.5 text-sm font-bold">
            City
            <input className={fieldClass} value={city} onChange={(event) => setCity(event.target.value)} autoComplete="off" />
          </label>
          <label className="grid gap-1.5 text-sm font-bold">
            Pincode
            <input
              className={fieldClass}
              value={pincode}
              onChange={(event) => setPincode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="leaf" size="sm" loading={pending}>
            Save location
          </Button>
          {message && (
            <p
              role="status"
              className={cn('text-sm font-semibold', message.tone === 'ok' ? 'text-[var(--leaf-ink)]' : 'text-danger')}
            >
              {message.text}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
