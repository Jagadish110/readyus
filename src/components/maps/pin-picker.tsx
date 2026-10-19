'use client';

import { useEffect, useRef, useState } from 'react';
import { hasMapsKey, loadGoogleMaps } from '@/lib/maps/loader';
import { pinLink, type LatLng } from '@/lib/orders/geo';

type Props = {
  value: LatLng;
  onChange: (point: LatLng) => void;
};

/** A draggable pin. Without a Maps key it shows the coordinates and a link instead. */
export function PinPicker({ value, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const marker = useRef<google.maps.Marker | null>(null);
  const change = useRef(onChange);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(hasMapsKey ? 'loading' : 'failed');

  useEffect(() => {
    change.current = onChange;
  }, [onChange]);

  const initial = useRef(value);
  useEffect(() => {
    if (!hasMapsKey || !box.current) return;
    let cancelled = false;
    const element = box.current;

    window.gm_authFailure = () => setState('failed');

    loadGoogleMaps()
      .then(() => {
        if (cancelled) return;
        const instance = new google.maps.Map(element, {
          center: initial.current,
          zoom: 17,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy'
        });
        const pin = new google.maps.Marker({
          map: instance,
          position: initial.current,
          draggable: true,
          title: 'Drag to your door'
        });
        const report = (latLng: google.maps.LatLng | null | undefined) => {
          if (latLng) change.current({ lat: latLng.lat(), lng: latLng.lng() });
        };
        pin.addListener('dragend', () => report(pin.getPosition()));
        instance.addListener('click', (event: google.maps.MapMouseEvent) => {
          pin.setPosition(event.latLng);
          report(event.latLng);
        });
        map.current = instance;
        marker.current = pin;
        setState('ready');
      })
      .catch(() => !cancelled && setState('failed'));

    return () => {
      cancelled = true;
      marker.current?.setMap(null);
      marker.current = null;
      map.current = null;
    };
  }, []);

  // Follow the pin when the position changes from outside (e.g. "use my location").
  useEffect(() => {
    if (state !== 'ready') return;
    marker.current?.setPosition(value);
    map.current?.panTo(value);
  }, [value, state]);

  if (state === 'failed') {
    return (
      <p className="rounded-[18px] bg-[var(--tile)] px-4 py-3 text-xs leading-relaxed text-[var(--text-muted)]">
        Pin saved at {value.lat.toFixed(5)}, {value.lng.toFixed(5)}.{' '}
        <a
          href={pinLink(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-[var(--leaf-ink)] underline"
        >
          Check it in Google Maps
        </a>
      </p>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[18px] ring-1 ring-[var(--line)]">
      <div ref={box} className="h-56 w-full bg-[var(--tile)]" aria-label="Drag the pin to your door" />
      {state === 'loading' && <div className="skeleton absolute inset-0" />}
      <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-3 pt-6 pb-2 text-[0.7rem] font-semibold text-white">
        Drag the pin to your door
      </p>
    </div>
  );
}
