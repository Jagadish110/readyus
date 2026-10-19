import 'server-only';

import { cookies } from 'next/headers';
import type { MarketplaceQuery } from './marketplace';

export const LOCATION_COOKIE = 'readyus-loc';

export type ServerLocation = {
  lat: number;
  lng: number;
  label: string;
  radiusKm: number;
};

/** Reads the pin the client mirrored into a cookie. Null before one is set. */
export async function readLocation(): Promise<ServerLocation | null> {
  const store = await cookies();
  const raw = store.get(LOCATION_COOKIE)?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<ServerLocation>;
    if (typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;

    return {
      lat: parsed.lat,
      lng: parsed.lng,
      label: parsed.label || 'Selected location',
      // Only the four radii the product offers are accepted.
      radiusKm: [1, 3, 5, 10].includes(Number(parsed.radiusKm)) ? Number(parsed.radiusKm) : 5
    };
  } catch {
    return null;
  }
}

export function toQuery(location: ServerLocation): MarketplaceQuery {
  return { lat: location.lat, lng: location.lng, radiusKm: location.radiusKm };
}
