/**
 * Loads the Google Maps JavaScript API once, in the browser, with the key from
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. The key is read from the environment and is
 * never hardcoded. It is public by nature (it ships to the browser), so it
 * must be restricted in Google Cloud to this site's HTTP referrers and to the
 * Maps JavaScript API only.
 */
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

/** True when a key is configured; callers show a plain fallback otherwise. */
export const hasMapsKey = KEY.length > 20 && !KEY.startsWith('your-');

let pending: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Maps loads in the browser only.'));
  if (!hasMapsKey) return Promise.reject(new Error('No Google Maps key configured.'));
  if (window.google?.maps) return Promise.resolve(window.google);
  if (pending) return pending;

  pending = new Promise<typeof google>((resolve, reject) => {
    const callback = `__readyusMapsReady`;
    (window as unknown as Record<string, () => void>)[callback] = () => resolve(window.google);

    const script = document.createElement('script');
    script.src =
      'https://maps.googleapis.com/maps/api/js?' +
      new URLSearchParams({ key: KEY, v: 'weekly', callback }).toString();
    script.async = true;
    script.onerror = () => {
      pending = null;
      reject(new Error('Google Maps failed to load.'));
    };
    document.head.appendChild(script);
  });

  return pending;
}
