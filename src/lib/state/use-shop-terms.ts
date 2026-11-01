'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_URL } from '@/lib/api/client';
import type { NearbySeller } from '@/lib/database.types';
import type { ShopTerms } from '@/lib/shop-terms';
import { useLocation } from './location';

/**
 * Delivery charge, minimum order and cash-on-delivery for the shops in the cart, read from the public
 * shop listing around the customer's pin (works for guests too). A shop missing from the answer is
 * out of range or closed down; callers treat it as "unknown" and let checkout give the final word.
 */
export function useShopTerms(sellerIds: string[]) {
  const { location } = useLocation();
  const [terms, setTerms] = useState<Record<string, ShopTerms>>({});
  const [loaded, setLoaded] = useState(false);
  const wanted = useMemo(() => [...new Set(sellerIds)].sort().join(','), [sellerIds]);

  useEffect(() => {
    if (!location || !wanted) {
      setLoaded(true);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng),
      radiusKm: String(location.radiusKm),
      limit: '100'
    });
    fetch(`${API_URL}/v1/public/sellers?${params.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ rows: NearbySeller[] }>) : { rows: [] }))
      .then(({ rows }) => {
        const ids = new Set(wanted.split(','));
        setTerms(Object.fromEntries(rows.filter((row) => ids.has(row.id)).map((row) => [row.id, row])));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => controller.abort();
  }, [location, wanted]);

  return { terms, loaded };
}
