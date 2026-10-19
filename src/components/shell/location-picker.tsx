'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RADIUS_OPTIONS, useLocation } from '@/lib/state/location';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PinIcon } from './icons';

/**
 * The "Change location" page. Unlike the gate (which only appears while no pin
 * exists), this is always shown, and sends the customer to the shops around
 * the new pin once one is saved.
 */
export function LocationPicker() {
  const router = useRouter();
  const {
    location,
    locating,
    error,
    useCurrentLocation: requestCurrentLocation,
    useSampleLocation: pickSampleLocation
  } = useLocation();
  const [radius, setRadius] = useState<number>(location?.radiusKm ?? 5);

  async function chooseCurrent() {
    if (await requestCurrentLocation(radius)) router.push('/browse');
  }

  function chooseSample() {
    pickSampleLocation(radius);
    router.push('/browse');
  }

  return (
    <section className="animate-rise mx-auto mt-6 max-w-md text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--leaf-soft)] text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
        <PinIcon className="size-7" />
      </span>

      <h1 className="mt-5 font-display text-[1.9rem] leading-tight font-extrabold tracking-[-0.04em]">
        Change your location
      </h1>
      <p className="mx-auto mt-2 max-w-[38ch] text-sm leading-relaxed text-[var(--text-muted)]">
        {location ? `Now delivering to ${location.label}. ` : ''}
        We will show the shops around you, and their food when they have listed any.
      </p>

      <div className="mt-6 text-left">
        <p className="mb-2 text-xs font-extrabold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">
          Show shops within
        </p>
        <div className="grid grid-cols-4 gap-2">
          {RADIUS_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={radius === option}
              onClick={() => setRadius(option)}
              className={cn(
                'h-11 rounded-full border text-sm font-bold transition-colors',
                radius === option
                  ? 'border-leaf-600 bg-[var(--leaf-soft)] text-[var(--leaf-ink)]'
                  : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
              )}
            >
              {option} km
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="animate-pop mt-5 rounded-lg border-l-[3px] border-warning bg-warning/12 px-3.5 py-3 text-left text-sm font-medium text-[var(--text)]"
        >
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-3">
        <Button size="lg" variant="leaf" fullWidth loading={locating} onClick={() => void chooseCurrent()}>
          Use my current location
        </Button>
        <Button size="lg" fullWidth variant="leaf-outline" onClick={chooseSample}>
          Browse a sample area
        </Button>
      </div>
    </section>
  );
}
