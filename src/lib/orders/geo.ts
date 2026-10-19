export type LatLng = { lat: number; lng: number };

/**
 * PostgREST returns a PostGIS point as hex-encoded EWKB. Reads that, a GeoJSON
 * point, or a "POINT(lng lat)" string into a lat/lng pair.
 */
export function parsePoint(value: unknown): LatLng | null {
  if (!value) return null;

  if (typeof value === 'object') {
    const coordinates = (value as { coordinates?: unknown }).coordinates;
    if (Array.isArray(coordinates) && coordinates.length >= 2) {
      return { lng: Number(coordinates[0]), lat: Number(coordinates[1]) };
    }
    return null;
  }

  if (typeof value !== 'string') return null;

  const text = value.match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
  if (text) return { lng: Number(text[1]), lat: Number(text[2]) };

  if (/^[0-9a-f]+$/i.test(value) && value.length >= 42) {
    const bytes = new Uint8Array(value.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
    const view = new DataView(bytes.buffer);
    const little = view.getUint8(0) === 1;
    const type = view.getUint32(1, little);
    // 0x20000000 flags an embedded SRID, which adds four bytes.
    const offset = type & 0x20000000 ? 9 : 5;
    const lng = view.getFloat64(offset, little);
    const lat = view.getFloat64(offset + 8, little);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  return null;
}

/** EWKT text PostgREST casts into a geography column. */
export const toPoint = ({ lat, lng }: LatLng) => `SRID=4326;POINT(${lng} ${lat})`;

/** A plain Google Maps link, which needs no API key. */
export function mapsLink(destination: LatLng, origin?: LatLng | null) {
  const params = new URLSearchParams({ api: '1', destination: `${destination.lat},${destination.lng}` });
  if (origin) params.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function pinLink(point: LatLng) {
  return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`;
}
