'use client';

import { useLocation } from '@/lib/state/location';
import { Button } from '@/components/ui/button';
import { PinIcon } from './icons';

/**
 * Localty cannot show a catalogue without a location, because the radius rule
 * is the catalogue. This asks once, then gets out of the way.
 */
export function LocationGate({ children }: { children: React.ReactNode }) {
  const {
    location,
    ready,
    locating,
    error,
    useCurrentLocation: requestCurrentLocation,
    useSampleLocation: pickSampleLocation
  } = useLocation();

  if (!ready) {
    return (
      <div className="grid gap-4">
        <div className="skeleton h-11 w-64 rounded-full" />
        <div className="skeleton h-44 rounded-[26px]" />
        <div className="skeleton h-44 rounded-[26px]" />
      </div>
    );
  }

  if (location) return <>{children}</>;

  return (
    <section className="animate-rise mx-auto mt-6 max-w-md text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--leaf-soft)] text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
        <PinIcon className="size-7" />
      </span>

      <h1 className="mt-5 font-display text-[1.9rem] leading-tight font-extrabold tracking-[-0.04em]">
        Where are we delivering?
      </h1>
      <p className="mx-auto mt-2 max-w-[38ch] text-sm leading-relaxed text-[var(--text-muted)]">
        Localty only shows shops that can actually reach you, so we need a
        location before we can show anything.
      </p>

      {error && (
        <p className="animate-pop mt-5 rounded-lg border-l-[3px] border-warning bg-warning/12 px-3.5 py-3 text-left text-sm font-medium text-[var(--text)]">
          {error}
        </p>
      )}

      <div className="mt-6 grid gap-3">
        <Button size="lg" variant="leaf" fullWidth loading={locating} onClick={() => void requestCurrentLocation()}>
          Use my current location
        </Button>
        <Button size="lg" fullWidth variant="leaf-outline" onClick={() => pickSampleLocation()}>
          Browse a sample area
        </Button>
      </div>

      <p className="mt-4 text-xs text-[var(--text-muted)]">
        Your location stays on this device and is only used to find nearby shops.
      </p>
    </section>
  );
}
