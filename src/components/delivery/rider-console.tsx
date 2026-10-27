'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { friendlyError } from '@/lib/orders/errors';
import { mapsLink, type LatLng } from '@/lib/orders/geo';
import type { MapInfo } from '@/lib/orders/load';
import { timeAgo } from '@/lib/orders/status';
import { LiveMap } from '@/components/maps/live-map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { formatPaise } from '@/lib/utils';

type Done = {
  order_id: string;
  cash_due_paise: number;
  delivered_at: string | null;
  order: { order_code: string; seller: { shop_name: string } | null } | null;
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
  const [history, setHistory] = useState<Done[]>([]);
  const [cash, setCash] = useState<Array<{ shop_name: string; orders: number; cash_paise: number }>>([]);
  const [exit, setExit] = useState<string | null>(null);
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
    const result = await api<{ active: Active[]; history: Done[]; maps: Record<string, MapInfo>; cash: Array<{ shop_name: string; orders: number; cash_paise: number }> }>(
      'GET',
      '/v1/rider/deliveries'
    );
    if (result.ok) {
      setHistory(result.data.history);
      setCash(result.data.cash ?? []);
      setActive(result.data.active);
      setMaps(result.data.maps);
    }
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
      const result = await api('POST', '/v1/rider/location', { lat: point.lat, lng: point.lng });
      if (result.ok) setLastSent(new Date().toISOString());
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

  async function act(key: string, call: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError('');
    const result = await call();
    setBusy('');
    if (!result.ok && result.error) setError(friendlyError(result.error));
    await refresh();
  }

  const post = (path: string, body?: Record<string, unknown>) => api('POST', path, body);

  async function join(event: React.FormEvent) {
    event.preventDefault();
    await act('join', () => post('/v1/rider/join', { code: invite }));
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

      {cash.length > 0 && (
        <section className="grid gap-1.5 rounded-[22px] bg-warning/12 p-4 text-sm ring-1 ring-warning/35">
          <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">Cash to hand over</h2>
          {cash.map((row) => (
            <p key={row.shop_name}>
              Give <span className="font-extrabold tabular-nums">{formatPaise(row.cash_paise)}</span> to {row.shop_name}{' '}
              <span className="text-[var(--text-muted)]">({row.orders} {row.orders === 1 ? 'order' : 'orders'})</span>
            </p>
          ))}
          <p className="text-xs text-[var(--text-muted)]">The shop marks it received once you hand it over.</p>
        </section>
      )}

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
              <Badge tone="leaf-soft">{toShop ? 'Assigned to you: collect it' : 'Take it to the customer'}</Badge>
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

            <div className="grid gap-2">
              {exit === assignment.order_id ? (
                <div className="grid gap-2 rounded-[18px] bg-[var(--tile)] p-3.5">
                  <p className="text-sm font-bold">{toShop ? 'Why can you not take it?' : 'What happened?'}</p>
                  <div className="flex flex-wrap gap-2">
                    {(toShop
                      ? [
                          ['release', 'My vehicle has a problem'],
                          ['release', 'It is too far'],
                          ['release', 'I am not available']
                        ]
                      : [
                          ['customer_unreachable', 'Customer not reachable'],
                          ['customer_refused', 'Customer refused it'],
                          ['wrong_address', 'Wrong address'],
                          ['rider_problem', 'I had a problem']
                        ]
                    ).map(([key, label]) => (
                      <Button
                        key={label}
                        size="sm"
                        variant="outline"
                        loading={busy === `exit-${assignment.order_id}-${label}`}
                        onClick={() =>
                          act(`exit-${assignment.order_id}-${label}`, async () => {
                            const done = toShop
                              ? await post(`/v1/rider/deliveries/${assignment.order_id}/release`, { reason: label })
                              : await post(`/v1/rider/deliveries/${assignment.order_id}/failed`, { cause: key });
                            if (done.ok) setExit(null);
                            return done;
                          })
                        }
                      >
                        {label}
                      </Button>
                    ))}
                    <Button size="sm" variant="ghost" onClick={() => setExit(null)}>
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="justify-self-start text-danger" onClick={() => setExit(assignment.order_id)}>
                  {toShop ? 'I cannot take this order' : 'I could not deliver it'}
                </Button>
              )}
            </div>

            {toShop ? (
              <Button
                variant="leaf"
                size="lg"
                loading={busy === `pick-${assignment.order_id}`}
                onClick={() => act(`pick-${assignment.order_id}`, () => post(`/v1/rider/deliveries/${assignment.order_id}/pickup`))}
              >
                I have picked it up
              </Button>
            ) : (
              <form
                className="grid gap-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  act(`done-${assignment.order_id}`, () =>
                    post(`/v1/rider/deliveries/${assignment.order_id}/complete`, {
                      code: (codes[assignment.order_id] ?? '').trim()
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

      {active.length === 0 && (
        <section className="grid gap-2 rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)]">
          <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">
            {!loaded ? 'Checking for deliveries…' : 'No delivery assigned to you right now'}
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            {fleets.length
              ? 'When a shop assigns you an order it appears here with the shop, the customer and the route. This page refreshes by itself, so you can leave it open.'
              : 'Join a shop’s team first. Then the shop can assign orders to you.'}
          </p>
        </section>
      )}

      {history.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-xs font-extrabold tracking-[0.16em] text-[var(--text-muted)] uppercase">Recently delivered</h2>
          <ul className="grid gap-2">
            {history.map((done) => (
              <li
                key={done.order_id}
                className="flex items-center justify-between gap-3 rounded-[20px] bg-[var(--surface)] px-4 py-3 text-sm shadow-xs ring-1 ring-[var(--line)]"
              >
                <span className="min-w-0">
                  <span className="block font-bold">{done.order?.order_code}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">
                    {done.order?.seller?.shop_name}
                    {done.delivered_at && ` · ${timeAgo(done.delivered_at, now)}`}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-extrabold text-[var(--leaf-ink)]">
                  {done.cash_due_paise > 0 ? `Cash ${formatPaise(done.cash_due_paise)}` : 'Paid online'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
