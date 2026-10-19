'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FIXTURE_ORIGIN } from '@/lib/data/fixtures';

export type DeliveryLocation = {
  lat: number;
  lng: number;
  label: string;
  radiusKm: number;
};

export const RADIUS_OPTIONS = [1, 3, 5, 10] as const;

const STORAGE_KEY = 'readyus-location';
export const LOCATION_COOKIE = 'readyus-loc';

/**
 * The pin is mirrored into a cookie so Server Components can run the radius
 * query during render instead of waiting for the client to report a position.
 */
function writeCookie(value: DeliveryLocation | null) {
  if (typeof document === 'undefined') return;
  if (!value) {
    document.cookie = `${LOCATION_COOKIE}=; path=/; max-age=0; samesite=lax`;
    return;
  }
  const encoded = encodeURIComponent(JSON.stringify(value));
  document.cookie = `${LOCATION_COOKIE}=${encoded}; path=/; max-age=31536000; samesite=lax`;
}

type LocationState = {
  location: DeliveryLocation | null;
  ready: boolean;
  locating: boolean;
  error: string;
  setRadius: (radiusKm: number) => void;
  /** Resolves true when a position was read and saved. */
  useCurrentLocation: (radiusKm?: number) => Promise<boolean>;
  useSampleLocation: (radiusKm?: number) => void;
  clear: () => void;
};

const Ctx = createContext<LocationState | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [location, setLocation] = useState<DeliveryLocation | null>(null);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  // Restore the saved pin before first paint of anything that needs it.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const restored = JSON.parse(raw) as DeliveryLocation;
        setLocation(restored);
        writeCookie(restored);
      }
    } catch {
      // Private mode or blocked storage; the picker will ask again.
    }
    setReady(true);
  }, []);

  const persist = useCallback(
    (next: DeliveryLocation | null) => {
      setLocation(next);
      try {
        if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        else localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Non-fatal: the choice simply will not survive a reload.
      }
      writeCookie(next);
      // Server Components re-run with the new radius.
      router.refresh();
    },
    [router]
  );

  const setRadius = useCallback(
    (radiusKm: number) => {
      if (!location) return;
      persist({ ...location, radiusKm });
    },
    [location, persist]
  );

  const useCurrentLocation = useCallback(async (radiusKm?: number) => {
    setError('');
    if (!('geolocation' in navigator)) {
      setError('This device cannot share a location. Pick a sample area instead.');
      return false;
    }

    setLocating(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 60000
        });
      });

      persist({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        label: 'Current location',
        radiusKm: radiusKm ?? location?.radiusKm ?? 5
      });
      return true;
    } catch {
      setError('We could not read your location. Allow access or pick a sample area.');
      return false;
    } finally {
      setLocating(false);
    }
  }, [location?.radiusKm, persist]);

  const useSampleLocation = useCallback((radiusKm?: number) => {
    setError('');
    persist({
      lat: FIXTURE_ORIGIN.lat,
      lng: FIXTURE_ORIGIN.lng,
      label: FIXTURE_ORIGIN.label,
      radiusKm: radiusKm ?? location?.radiusKm ?? 5
    });
  }, [location?.radiusKm, persist]);

  const value = useMemo<LocationState>(
    () => ({
      location,
      ready,
      locating,
      error,
      setRadius,
      useCurrentLocation,
      useSampleLocation,
      clear: () => persist(null)
    }),
    [location, ready, locating, error, setRadius, useCurrentLocation, useSampleLocation, persist]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocation() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocation must be used inside LocationProvider');
  return ctx;
}
