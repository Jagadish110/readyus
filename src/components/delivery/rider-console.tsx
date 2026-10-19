'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/orders/errors';
import { ordersDb, rows } from '@/lib/orders/db';
import { mapsLink, type LatLng } from '@/lib/orders/geo';
import type { MapInfo } from '@/lib/orders/load';
import { timeAgo } from '@/lib/orders/status';
import { LiveMap } from '@/components/maps/live-map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { formatPaise } from '@/lib/utils';

type Available = {
  order_id: string;
  order_code: string;
  seller_name: string;
  city: string;
  distance_km: number | string | null;
  total_paise: number;
  cash_due_paise: number;
  packed_at: string | null;
};

type Active = {
  order_id: string;
  status: 'claimed' | 'picked_up';
  cash_due_paise: number;
  order: {
    order_code: string;
    delivery_address: { recipient?: string; phone?: string; line1?: string; line2?: string; landmark?: string; city?: string };
    seller: { shop_name: string; address: string | null; phone: string | null } | null;
  } | null;
};

const REPORT_EVERY_MS = 10_000;

export function RiderConsole({ name, fleetNames }: { name: string; fleetNames: string[] }) {
  const router = useRouter();
  const fleets = fleetNames;
  const [available, setAvailable] = useState<Available[]>([]);
  const [active, setActive] = useState<Active[]>([]);
  const [maps, setMaps] = useState<Record<string, MapInfo>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [invite, setInvite] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // Location sharing state.
  const position = useRef<LatLng | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [geoError, setGeoError] = useState('');

  const refresh = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const db = ordersDb(supabase);

    const [open, mine] = await Promise.all([
      db.rpc('available_deliveries'),
      db
        .from('delivery_assignments')
        .select(
          'order_id, status, cash_due_paise, order:orders(order_code, delivery_address, seller:sellers(shop_name, address, phone))'
        )
        .in('status', ['claimed', 'picked_up'])
    ]);

    const mineRows = rows<Active>(mine);
    setAvailable(rows<Available>(open));
    setActive(mineRows);

    // Coordinates for the route come from the same function the customer's map uses.
    const entries = await Promise.all(
      mineRows.map(async (assignment) => {
        const result = await db.rpc('order_map', { p_order: assignment.order_id });
        const info = Array.isArray(result.data) ? (result.data[0] as MapInfo | undefined) : undefined;
        return [assignment.order_id, info] as const;
      })
    );
    setMaps(Object.fromEntries(entries.filter((entry): entry is [string, MapInfo] => Boolean(entry[1]))));
    setLoaded(true);
  }, []);

  useEffect(() => {
    // Initial load plus a steady refresh; the lists are small and the rpc is cheap.
    refresh();
    const timer = window.setInterval(() => {
      refresh();
      setNow(Date.now());
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // While a delivery is active, watch the device position and report it every 10s.
  const delivering = active.length > 0;
  useEffect(() => {
    if (!delivering) return;
    if (!navigator.geolocation) {
      setGeoError('This browser cannot share location, so customers cannot follow you on the map.');
      return;
    }
    const supabase = createClient();
    if (!supabase) return;

    const watch = navigator.geolocation.watchPosition(
      (fix) => {
        const point = { lat: fix.coords.latitude, lng: fix.coords.longitude };
        position.current = point;
        setMe(point);
        setGeoError('');
      },
      () => setGeoError('Location is blocked. Allow it in your browser so customers can follow you on the map.'),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 }
    );

    const send = async () => {
      const point = position.current;
      if (!point) return;
      const result = await ordersDb(supabase).rpc('report_agent_location', { p_lat: point.lat, p_lng: point.lng });
      if (!result.error) setLastSent(new Date().toISOString());
    };
    const first = window.setTimeout(send, 2_000);
    const timer = window.setInterval(send, REPORT_EVERY_MS);

    return () => {
      navigator.geolocation.clearWatch(watch);
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [delivering]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  async function act(key: string, call: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key);
    setError('');
    const result = await call();
    setBusy('');
    if (result.error) setError(friendlyError(result.error.message));
    await refresh();
  }

  const rpc = (fn: string, args: Record<string, unknown>) => {
    const supabase = createClient();
    return supabase ? ordersDb(supabase).rpc(fn, args) : Promise.resolve({ error: { message: 'offline' } });
  };

  async function join(event: React.FormEvent) {
    event.preventDefault();
    await act('join', () => rpc('redeem_delivery_invite', { p_code: invite }));
    setInvite('');
    // The team list is server-rendered, so re-run the page to pick up the new shop.
    router.refresh();
  }

  return (
    <div className="animate-rise grid gap-5">
      <div>
        <Eyebrow>Delivery partner</Eyebrow>
        <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
          Hi {name.split(' ')[0] || 'there'}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {fleets.length ? `Delivering for ${fleets.join(', ')}.` : 'You are not on a shop’s delivery team yet.'}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
          {error}
        </p>
      )}

      {fleets.length === 0 && (
        <form
          onSubmit={join}
          className="grid gap-3 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)]"
        >
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Join a shop&rsquo;s team</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Ask the shop for a delivery code (it is in their Orders page) and enter it here.
          </p>
          <input
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
            placeholder="Delivery code"
            autoCapitalize="characters"
            className="h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-bold tracking-widest uppercase outline-none focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20"
          />
          <Button type="submit" variant="leaf" loading={busy === 'join'} disabled={!invite.trim()}>
            Join team
          </Button>
        </form>
      )}

      {delivering && (
        <p className="flex flex-wrap items-center gap-2 rounded-[20px] bg-[var(--leaf-soft)] px-4 py-3 text-xs font-semibold text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-success" />
          {geoError
            ? geoError
            : lastSent
              ? `Sharing your location with the customer · sent ${timeAgo(lastSent, now)}`
              : 'Finding your location…'}
        </p>
      )}

      {active.map((assignment) => {
        const info = maps[assignment.order_id];
        const order = assignment.order;
        const toShop = assignment.status === 'claimed';
        const target: LatLng | null = info
          ? toShop
            ? { lat: info.shop_lat, lng: info.shop_lng }
            : { lat: info.dest_lat, lng: info.dest_lng }
          : null;
        const address = order?.delivery_address;
        return (
          <section
            key={assignment.order_id}
            className="grid gap-3.5 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] sm:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">
                {order?.order_code}
              </h2>
              <Badge tone="leaf-soft">{toShop ? 'Go to the shop' : 'Take it to the customer'}</Badge>
            </div>

            <div className="grid gap-1 text-sm">
              <p className="font-bold">{order?.seller?.shop_name}</p>
              <p className="text-[var(--text-muted)]">{order?.seller?.address}</p>
              {order?.seller?.phone && (
                <a href={`tel:${order.seller.phone}`} className="w-fit font-bold text-[var(--leaf-ink)] underline">
                  Call shop
                </a>
              )}
            </div>

            <div className="grid gap-1 rounded-[18px] bg-[var(--tile)] p-3.5 text-sm">
              <p className="font-bold">{address?.recipient || 'Customer'}</p>
              <p className="text-[var(--text-muted)]">
                {[address?.line1, address?.line2, address?.landmark, address?.city].filter(Boolean).join(', ')}
              </p>
              {address?.phone && (
                <a href={`tel:${address.phone}`} className="w-fit font-bold text-[var(--leaf-ink)] underline">
                  Call customer
                </a>
              )}
            </div>

            {assignment.cash_due_paise > 0 ? (
              <p className="text-sm">
                Collect cash: <span className="font-extrabold tabular-nums text-brand-600">{formatPaise(assignment.cash_due_paise)}</span>
              </p>
            ) : (
              <p className="text-sm font-semibold text-[var(--leaf-ink)]">Already paid online. Collect no cash.</p>
            )}

            {info && (
              <LiveMap
                shop={{ lat: info.shop_lat, lng: info.shop_lng }}
                home={{ lat: info.dest_lat, lng: info.dest_lng }}
                rider={me}
              />
            )}

            {target && (
              <a
                href={mapsLink(target, me)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 w-fit items-center rounded-full bg-[var(--leaf-soft)] px-5 text-sm font-bold text-[var(--leaf-ink)]"
              >
                Navigate in Google Maps
              </a>
            )}

            {toShop ? (
              <Button
                variant="leaf"
                size="lg"
                loading={busy === `pick-${assignment.order_id}`}
                onClick={() => act(`pick-${assignment.order_id}`, () => rpc('pickup_delivery', { p_order: assignment.order_id }))}
              >
                I have picked it up
              </Button>
            ) : (
              <form
                className="grid gap-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  act(`done-${assignment.order_id}`, () =>
                    rpc('complete_delivery', {
                      p_order: assignment.order_id,
                      p_code: (codes[assignment.order_id] ?? '').trim()
                    })
                  );
                }}
              >
                <label className="text-xs font-extrabold tracking-[0.14em] text-[var(--text-muted)] uppercase" htmlFor={`code-${assignment.order_id}`}>
                  Customer&rsquo;s 6-digit code
                </label>
                <input
                  id={`code-${assignment.order_id}`}
                  value={codes[assignment.order_id] ?? ''}
                  onChange={(event) =>
                    setCodes((current) => ({ ...current, [assignment.order_id]: event.target.value.replace(/\D/g, '').slice(0, 6) }))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className="h-14 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-center font-display text-2xl font-extrabold tracking-[0.3em] outline-none focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20"
                />
                <Button
                  type="submit"
                  size="lg"
                  loading={busy === `done-${assignment.order_id}`}
                  disabled={(codes[assignment.order_id] ?? '').length !== 6}
                >
                  Complete delivery
                </Button>
              </form>
            )}
          </section>
        );
      })}

      <section className="grid gap-3">
        <h2 className="text-xs font-extrabold tracking-[0.16em] text-[var(--text-muted)] uppercase">
          Ready for pickup
        </h2>
        {!loaded ? (
          <div className="skeleton h-24 rounded-[26px]" />
        ) : available.length === 0 ? (
          <p className="rounded-[26px] bg-[var(--surface)] p-5 text-sm text-[var(--text-muted)] shadow-sm ring-1 ring-[var(--line)]">
            {fleets.length
              ? 'No orders are waiting right now. This list refreshes by itself.'
              : 'Join a shop’s team to see its orders here.'}
          </p>
        ) : (
          <ul className="grid gap-3">
            {available.map((order) => (
              <li
                key={order.order_id}
                className="grid gap-3 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-base font-extrabold tracking-[-0.025em]">{order.seller_name}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {order.order_code} &middot; {order.distance_km ? `${order.distance_km} km` : order.city}
                      {order.packed_at && ` · packed ${timeAgo(order.packed_at, now)}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-extrabold tabular-nums text-brand-600">
                    {order.cash_due_paise > 0 ? `Cash ${formatPaise(order.cash_due_paise)}` : 'Paid'}
                  </span>
                </div>
                <Button
                  variant="leaf"
                  loading={busy === `claim-${order.order_id}`}
                  disabled={active.length > 0}
                  onClick={() => act(`claim-${order.order_id}`, () => rpc('claim_delivery', { p_order: order.order_id }))}
                >
                  {active.length > 0 ? 'Finish your current delivery first' : 'Take this delivery'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
