'use client';

import { useEffect, useRef, useState } from 'react';
import { hasMapsKey, loadGoogleMaps } from '@/lib/maps/loader';
import { mapsLink, pinLink, type LatLng } from '@/lib/orders/geo';
import { cn } from '@/lib/utils';

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

const COLORS = { shop: '#f59300', home: '#1c1614', rider: '#246540' };

function pinIcon(fill: string, scale = 11): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 3,
    scale
  };
}

type Props = {
  shop: LatLng;
  home: LatLng;
  /** Omit until the order is picked up. */
  rider?: LatLng | null;
  className?: string;
};

/**
 * Shop pin, customer pin and a moving rider marker with a route line. Falls
 * back to plain text and a Google Maps link when no key is configured or the
 * Maps script cannot load, so the order page always works.
 */
export function LiveMap({ shop, home, rider = null, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const riderMarker = useRef<google.maps.Marker | null>(null);
  const line = useRef<google.maps.Polyline | null>(null);
  const frame = useRef<number>(0);
  const fitted = useRef(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(hasMapsKey ? 'loading' : 'failed');

  // Build the map and the two fixed pins once.
  useEffect(() => {
    if (!hasMapsKey || !box.current) return;
    let cancelled = false;
    const element = box.current;

    window.gm_authFailure = () => setState('failed');

    loadGoogleMaps()
      .then(() => {
        if (cancelled) return;
        const instance = new google.maps.Map(element, {
          center: home,
          zoom: 14,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'cooperative'
        });
        map.current = instance;

        new google.maps.Marker({
          map: instance,
          position: shop,
          title: 'Shop',
          icon: pinIcon(COLORS.shop),
          label: { text: 'S', color: '#ffffff', fontWeight: '800', fontSize: '11px' }
        });
        new google.maps.Marker({
          map: instance,
          position: home,
          title: 'You',
          icon: pinIcon(COLORS.home),
          label: { text: 'H', color: '#ffffff', fontWeight: '800', fontSize: '11px' }
        });

        line.current = new google.maps.Polyline({
          map: instance,
          path: [shop, home],
          strokeColor: COLORS.rider,
          strokeOpacity: 0.85,
          strokeWeight: 4,
          geodesic: true
        });

        const bounds = new google.maps.LatLngBounds();
        bounds.extend(shop);
        bounds.extend(home);
        instance.fitBounds(bounds, 56);
        setState('ready');
      })
      .catch(() => !cancelled && setState('failed'));

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
      riderMarker.current?.setMap(null);
      riderMarker.current = null;
      line.current?.setMap(null);
      line.current = null;
      map.current = null;
      fitted.current = false;
    };
  }, [shop, home]);

  // Move the rider smoothly and keep the route line pointed at the customer.
  const riderLat = rider?.lat;
  const riderLng = rider?.lng;
  useEffect(() => {
    const instance = map.current;
    if (state !== 'ready' || !instance) return;

    if (riderLat === undefined || riderLng === undefined) {
      riderMarker.current?.setMap(null);
      riderMarker.current = null;
      line.current?.setPath([shop, home]);
      return;
    }

    const target = { lat: riderLat, lng: riderLng };

    if (!riderMarker.current) {
      riderMarker.current = new google.maps.Marker({
        map: instance,
        position: target,
        title: 'Your rider',
        zIndex: 10,
        icon: pinIcon(COLORS.rider, 13),
        label: { text: 'R', color: '#ffffff', fontWeight: '800', fontSize: '12px' }
      });
    } else {
      const marker = riderMarker.current;
      const from = marker.getPosition();
      const start = performance.now();
      const duration = 1200;
      cancelAnimationFrame(frame.current);
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        if (from) {
          marker.setPosition({
            lat: from.lat() + (target.lat - from.lat()) * t,
            lng: from.lng() + (target.lng - from.lng()) * t
          });
        }
        if (t < 1) frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    }

    line.current?.setPath([target, home]);

    // Frame all three the first time, then only follow when the rider drifts out of view.
    const view = instance.getBounds();
    if (!fitted.current || (view && !view.contains(target))) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(shop);
      bounds.extend(home);
      bounds.extend(target);
      instance.fitBounds(bounds, 56);
      fitted.current = true;
    }
  }, [riderLat, riderLng, state, shop, home]);

  if (state === 'failed') {
    return (
      <div
        className={cn(
          'grid gap-3 rounded-[22px] bg-[var(--tile)] p-5 text-sm ring-1 ring-[var(--line)]',
          className
        )}
      >
        <p className="font-bold">
          {rider ? 'Your rider is on the way.' : 'Live map is not available right now.'}
        </p>
        <p className="text-[var(--text-muted)]">
          {rider
            ? 'The map could not be shown here, but you can follow the rider in Google Maps.'
            : 'You can still open the route in Google Maps.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={mapsLink(home, rider ?? shop)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-[var(--leaf-soft)] px-4 py-2 text-sm font-bold text-[var(--leaf-ink)]"
          >
            Open in Google Maps
          </a>
          {rider && (
            <a
              href={pinLink(rider)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-bold"
            >
              Where is the rider?
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-[22px] ring-1 ring-[var(--line)]', className)}>
      <div ref={box} className="h-72 w-full bg-[var(--tile)] sm:h-96" aria-label="Live delivery map" />
      {state === 'loading' && <div className="skeleton absolute inset-0" />}
    </div>
  );
}
