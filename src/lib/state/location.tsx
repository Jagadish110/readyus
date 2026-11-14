'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { refreshWhenVisible } from '@/lib/refresh-when-visible';

export type DeliveryLocation = {
  lat: number;
  lng: number;
  label: string;
  radiusKm: number;
  /** How far off the phone said the reading could be, in metres. Only for a reading from the device. */
  accuracyM?: number;
  /** When the device reading was taken (ms since epoch), so an old pin can be refreshed. */
  savedAt?: number;
};

const CURRENT_LABEL = 'Current location';
/** A reading worse than this came from cell towers or Wi-Fi, not GPS, and can be kilometres off. */
const ROUGH_ACCURACY_M = 1000;
/** Good enough to stop waiting for a better reading. */
const GOOD_ACCURACY_M = 100;

/**
 * A fresh reading from the device. Phones often answer first with a rough network position and improve
 * it over a few seconds as GPS locks on, so this keeps the most accurate reading seen for up to
 * `waitMs`, stopping early once one is good enough. A cached position is never used: a pin from
 * somewhere the phone was earlier is how a customer ends up shown shops from another area.
 */
function readDevicePosition(waitMs = 10_000, { waitForAnswer = false } = {}): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    let done = false;
    let watchId = 0;
    const finish = () => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(new Error('NO_POSITION'));
    };
    // While the browser is still asking "allow location?", the clock must not run out on the customer:
    // with waitForAnswer the wait starts at the first reading (a minute at most for an unanswered prompt).
    let timer = setTimeout(finish, waitForAnswer ? 60_000 : waitMs);
    let started = !waitForAnswer;
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
        if (position.coords.accuracy <= GOOD_ACCURACY_M) return finish();
        if (!started) {
          started = true;
          clearTimeout(timer);
          timer = setTimeout(finish, waitMs);
        }
      },
      (error) => {
        // Keep a reading already taken; fail only when there is none.
        if (best) finish();
        else if (!done) {
          done = true;
          navigator.geolocation.clearWatch(watchId);
          clearTimeout(timer);
          reject(error);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: waitMs }
    );
  });
}

/**
 * The phone's position: GPS first, and if that fails for any reason but a refusal (indoors GPS often needs
 * longer than we wait), the quicker Wi-Fi or mobile-network position, which can be a couple of minutes old.
 * A refusal is passed on as is, so the message can say how to allow it.
 */
async function readLocation(waitMs = 10_000, options: { waitForAnswer?: boolean } = {}): Promise<GeolocationPosition> {
  try {
    return await readDevicePosition(waitMs, options);
  } catch (error) {
    if ((error as GeolocationPositionError).code === 1) throw error;
    return new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, maximumAge: 120_000, timeout: 15_000 })
    );
  }
}

const ON_IPHONE = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

/** What went wrong, in words that say what to do about it. */
function failureMessage(error: unknown): string {
  const code = (error as GeolocationPositionError | undefined)?.code;
  if (code === 1) {
    return ON_IPHONE()
      ? 'Location is blocked for localty.in. On your iPhone open Settings, then Privacy & Security, Location Services, ' +
          'Safari Websites, and choose While Using the App. Then in Safari tap aA in the address bar, Website Settings, ' +
          'Location, Allow, and reload this page.'
      : 'Location is blocked for localty.in. Tap the icon at the left of the address bar, open Permissions (or Site ' +
          'settings), set Location to Allow, and reload this page. Turning on location for the phone alone is not ' +
          'enough while the site is blocked.';
  }
  if (code === 2) {
    return 'Your phone could not find where it is. Turn on Location in your phone’s quick settings, then try again.';
  }
  return 'Finding your location took too long. Check that Location is on, move near a window or turn on Wi-Fi, and try again.';
}

function fromPosition(position: GeolocationPosition, radiusKm: number): DeliveryLocation {
  const accuracyM = Math.round(position.coords.accuracy);
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    label: accuracyM > ROUGH_ACCURACY_M ? `${CURRENT_LABEL} (approximate)` : CURRENT_LABEL,
    radiusKm,
    accuracyM,
    savedAt: Date.now()
  };
}

function roughWarning(accuracyM: number) {
  const km = Math.max(1, Math.round(accuracyM / 1000));
  return `Your phone could only give a rough location (up to ${km} km off), so nearby shops may be missing. Turn on GPS or precise location for this browser and tap Use current location again.`;
}

/** 'granted', 'prompt' (the browser will ask) or 'denied'. Browsers without the Permissions API count as 'prompt'. */
async function locationPermission(): Promise<PermissionState> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return status?.state ?? 'prompt';
  } catch {
    return 'prompt';
  }
}

export const RADIUS_OPTIONS = [1, 3, 5, 10] as const;

const STORAGE_KEY = 'readyus-location';

/** Set for the rest of a visit (this tab) once the location has been read, so it is asked once per visit. */
const VISIT_KEY = 'localty-located-this-visit';
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

/**
 * Forget the saved place on this device, so whoever signs in next starts from their own location
 * instead of the last person's. Called when signing out.
 */
export function forgetSavedLocation() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(VISIT_KEY);
  } catch {
    // Storage blocked: nothing was saved there.
  }
  writeCookie(null);
}

type LocationState = {
  location: DeliveryLocation | null;
  ready: boolean;
  locating: boolean;
  /** Reading the phone's location as the site opens; pages wait for it instead of showing the old area. */
  detecting: boolean;
  /** Stop waiting and keep showing the saved area. */
  skipDetecting: () => void;
  /** Set when this visit could not read the location and the shops shown are for a place saved earlier. */
  staleNote: string;
  error: string;
  setRadius: (radiusKm: number) => void;
  /** Resolves true when a position was read and saved. */
  useCurrentLocation: (radiusKm?: number) => Promise<boolean>;
  clear: () => void;
};

const Ctx = createContext<LocationState | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [location, setLocation] = useState<DeliveryLocation | null>(null);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [staleNote, setStaleNote] = useState('');
  const skipped = useRef(false);
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
      refreshWhenVisible(() => router.refresh());
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

  // Every visit starts from where the phone is now, as delivery apps do, not from a place saved on an
  // earlier visit: a customer who travelled would otherwise see the shops of the town they left. The browser
  // asks for permission if it has not been given. If it is refused or fails, the saved place is kept.
  useEffect(() => {
    if (!ready || !('geolocation' in navigator)) return;
    try {
      if (sessionStorage.getItem(VISIT_KEY)) return;
      sessionStorage.setItem(VISIT_KEY, '1');
    } catch {
      // Storage blocked: read the location anyway; at worst it is read again on the next page load.
    }

    let cancelled = false;
    // Without a fresh reading the saved place stays, but the customer is told the shops are for that
    // place and why, so they are not puzzled by shops from a town they left. With no saved place the
    // picker shows the reason.
    const fellBack = (error: unknown) => {
      const reason = failureMessage(error);
      if (location) setStaleNote(reason);
      else setError(reason);
    };
    void (async () => {
      const permission = await locationPermission();
      if (cancelled) return;
      // Blocked in the browser: it will not ask again, so say how to allow it.
      if (permission === 'denied') return fellBack({ code: 1 });
      setDetecting(true);
      try {
        const fresh = fromPosition(
          await readLocation(6_000, { waitForAnswer: permission === 'prompt' }),
          location?.radiusKm ?? 5
        );
        if (cancelled || skipped.current) return;
        persist(fresh);
        setStaleNote('');
        if ((fresh.accuracyM ?? 0) > ROUGH_ACCURACY_M) setError(roughWarning(fresh.accuracyM ?? 0));
      } catch (error) {
        if (!cancelled && !skipped.current) fellBack(error);
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per visit, when the saved place has been restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const skipDetecting = useCallback(() => {
    skipped.current = true;
    setDetecting(false);
  }, []);

  const useCurrentLocation = useCallback(async (radiusKm?: number) => {
    setError('');
    if (!('geolocation' in navigator)) {
      setError('This device cannot share a location, so we cannot find shops near you.');
      return false;
    }

    setLocating(true);
    try {
      const next = fromPosition(await readLocation(), radiusKm ?? location?.radiusKm ?? 5);
      persist(next);
      setStaleNote('');
      if ((next.accuracyM ?? 0) > ROUGH_ACCURACY_M) setError(roughWarning(next.accuracyM ?? 0));
      return true;
    } catch (error) {
      const reason = failureMessage(error);
      setError(reason);
      if (location) setStaleNote(reason);
      return false;
    } finally {
      setLocating(false);
    }
  }, [location, persist]);

  const value = useMemo<LocationState>(
    () => ({
      location,
      ready,
      locating,
      detecting,
      skipDetecting,
      staleNote,
      error,
      setRadius,
      useCurrentLocation,
      clear: () => persist(null)
    }),
    [location, ready, locating, detecting, skipDetecting, staleNote, error, setRadius, useCurrentLocation, persist]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocation() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocation must be used inside LocationProvider');
  return ctx;
}
