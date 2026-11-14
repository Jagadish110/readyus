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
    detecting,
    skipDetecting,
    staleNote,
    error,
    useCurrentLocation: requestCurrentLocation
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

  // As the site opens it reads where the phone is now. Until then, do not show the shops of a place saved
  // on an earlier visit, which may be another town.
  if (detecting) {
    return (
      <section role="status" className="animate-rise mx-auto mt-10 max-w-md text-center">
        <span className="mx-auto grid size-16 animate-pulse place-items-center rounded-full bg-[var(--leaf-soft)] text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
          <PinIcon className="size-7" />
        </span>
        <h1 className="mt-5 font-display text-[1.6rem] leading-tight font-extrabold tracking-[-0.04em]">
          Finding shops near you
        </h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-sm leading-relaxed text-[var(--text-muted)]">
          Allow location if your browser asks, so we show the shops that can deliver to where you are now.
        </p>
        {location && (
          <Button size="sm" variant="leaf-outline" className="mt-5" onClick={skipDetecting}>
            Show shops near {location.label.split(',')[0]} instead
          </Button>
        )}
      </section>
    );
  }

  if (location && staleNote) {
    // The location could not be read on this visit: say whose shops these are, why, and how to fix it.
    return (
      <div className="grid gap-5">
        <section role="status" className="animate-rise grid gap-2.5 rounded-[22px] bg-warning/12 p-4 text-sm ring-1 ring-warning/35">
          <p className="font-bold text-[var(--text)]">
            We could not read your location, so these are shops near {location.label.split(',')[0]} from an earlier visit.
          </p>
          <p className="leading-relaxed text-[var(--text-muted)]">{error || staleNote}</p>
          <Button size="sm" variant="leaf" className="w-fit" loading={locating} onClick={() => void requestCurrentLocation()}>
            Try again
          </Button>
        </section>
        {children}
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
      </div>

      <p className="mt-4 text-xs text-[var(--text-muted)]">
        Your location stays on this device and is only used to find nearby shops.
      </p>
    </section>
  );
}
