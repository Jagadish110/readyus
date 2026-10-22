'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/lib/state/cart';
import { useLocation } from '@/lib/state/location';
import { createClient } from '@/lib/supabase/client';
import { api } from '@/lib/api/client';
import { friendlyError } from '@/lib/orders/errors';
import { parsePoint } from '@/lib/orders/geo';
import { Button, ButtonLink } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { Dish } from '@/components/art/dish-photo';
import { AddressForm, type AddressRow } from './address-form';
import { cn, formatRupees } from '@/lib/utils';

// No delivery or platform charge for now; the database enforces the same
// (place_order ignores fees). Nothing here adds to the total.
type PayChoice = 'cod' | 'online';
type Who = { id: string } | null;

export function CheckoutView() {
  const router = useRouter();
  const { groups, ready, subtotal, setQuantity } = useCart();
  const { location } = useLocation();
  const [who, setWho] = useState<Who | undefined>(undefined);
  const [addresses, setAddresses] = useState<AddressRow[] | null>(null);
  const [addressId, setAddressId] = useState('');
  const [adding, setAdding] = useState(false);
  const [pay, setPay] = useState<PayChoice>('cod');
  const [note, setNote] = useState('');
  const [placing, setPlacing] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setWho(null);
      return;
    }
    supabase.auth.getUser().then(({ data }) => setWho(data.user ? { id: data.user.id } : null));
  }, []);

  const loadAddresses = useCallback(async (select?: string) => {
    const result = await api<{ addresses: AddressRow[] }>('GET', '/v1/addresses');
    if (!result.ok) {
      setAddresses([]);
      setProblems([result.error]);
      return;
    }
    const list = result.data.addresses;
    setAddresses(list);
    setAddressId((current) => select ?? (list.some((a) => a.id === current) ? current : (list[0]?.id ?? '')));
    if (!list.length) setAdding(true);
  }, []);

  useEffect(() => {
    if (who) loadAddresses();
  }, [who, loadAddresses]);

  const startPin = useMemo(
    () => (location ? { lat: location.lat, lng: location.lng } : null),
    [location]
  );

  async function placeAll() {
    if (!who || !addressId) return;

    setPlacing(true);
    setProblems([]);

    // One request; the backend places each shop as its own order, so one shop
    // failing never undoes the others, and it prices everything from the database.
    const result = await api<{ placed: string[]; failed: Array<{ sellerId: string; message: string }> }>(
      'POST',
      '/v1/checkout',
      {
        addressId,
        payOnline: pay === 'online',
        note: note.trim(),
        shops: groups.map((group) => ({
          sellerId: group.sellerId,
          lines: group.lines.map((line) => ({ productId: line.productId, quantity: line.quantity }))
        }))
      }
    );

    if (!result.ok) {
      setPlacing(false);
      setProblems([friendlyError(result.error)]);
      return;
    }

    const { placed, failed } = result.data;
    const nameOf = (sellerId: string) => groups.find((group) => group.sellerId === sellerId)?.sellerName ?? 'A shop';
    const reasons = failed.map((item) => nameOf(item.sellerId) + ': ' + friendlyError(item.message));

    // Clear only the shops that went through; the rest stay in the cart.
    const placedSellers = new Set(groups.map((group) => group.sellerId));
    for (const item of failed) placedSellers.delete(item.sellerId);
    for (const group of groups) {
      if (placedSellers.has(group.sellerId)) for (const line of group.lines) setQuantity(line.productId, 0);
    }

    setProblems(reasons);

    if (placed.length && !failed.length) {
      // The cart is already empty; keep the loading state so the "Nothing to
      // check out" screen never flashes before the order page opens.
      setRedirecting(true);
      router.push(placed.length === 1 ? `/orders/${placed[0]}` : '/orders');
    } else {
      setPlacing(false);
      if (placed.length) {
        setProblems([...reasons, `${placed.length} order${placed.length > 1 ? 's were' : ' was'} placed. See Orders.`]);
      }
    }
  }

  if (redirecting || !ready || who === undefined) return <div className="skeleton h-72 rounded-[26px]" />;

  if (!groups.length) {
    return (
      <div className="animate-rise mx-auto mt-8 max-w-md rounded-[30px] bg-[var(--surface)] p-9 text-center shadow-sm ring-1 ring-[var(--line)]">
        <span
          aria-hidden
          className="relative mx-auto block size-28 overflow-hidden rounded-full bg-[var(--tile)]"
        >
          <Dish name="kirana" sizes="112px" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-extrabold tracking-[-0.035em]">
          Nothing to check out
        </h1>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <ButtonLink href="/browse" variant="leaf" size="lg">
            Browse shops
          </ButtonLink>
          <ButtonLink href="/orders" variant="leaf-outline" size="lg">
            Your orders
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (!who) {
    return (
      <div className="animate-rise mx-auto mt-8 max-w-md rounded-[30px] bg-[var(--surface)] p-9 text-center shadow-sm ring-1 ring-[var(--line)]">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.035em]">Sign in to order</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          You can browse and fill a cart as a guest. An account lets the shop and your rider reach you.
        </p>
        <ButtonLink href="/sign-in?next=/checkout" variant="leaf" size="lg" fullWidth className="mt-6">
          Sign in
        </ButtonLink>
      </div>
    );
  }

  const canPlace = Boolean(addressId) && !adding && !placing;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="grid gap-5">
        <div className="animate-rise">
          <Eyebrow>Almost there</Eyebrow>
          <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">
            Checkout
          </h1>
        </div>

        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] [animation-delay:60ms]">
          <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">Delivering to</h2>

          {addresses === null ? (
            <div className="skeleton mt-3 h-20 rounded-[18px]" />
          ) : (
            <>
              {addresses.length > 0 && (
                <div className="mt-3 grid gap-2.5" role="radiogroup" aria-label="Delivery address">
                  {addresses.map((address) => {
                    const active = address.id === addressId && !adding;
                    return (
                      <button
                        key={address.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setAddressId(address.id);
                          setAdding(false);
                        }}
                        className={cn(
                          'flex items-start gap-3 rounded-[18px] border-[1.5px] p-3.5 text-left transition-all duration-200',
                          active
                            ? 'border-leaf-500 bg-[var(--leaf-soft)]'
                            : 'border-[var(--line)] hover:border-leaf-300 hover:bg-[var(--tile)]'
                        )}
                      >
                        <Radio active={active} />
                        <span className="min-w-0">
                          <span className="block text-sm font-bold">
                            {address.label}
                            {address.recipient && (
                              <span className="font-medium text-[var(--text-muted)]"> &middot; {address.recipient}</span>
                            )}
                          </span>
                          <span className="block text-xs leading-relaxed text-[var(--text-muted)]">
                            {[address.line1, address.line2, address.landmark, address.city, address.pincode]
                              .filter(Boolean)
                              .join(', ')}
                          </span>
                          {!parsePoint(address.location) && (
                            <span className="block text-xs font-semibold text-danger">No map pin on this address</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {adding ? (
                <AddressForm
                  startPin={startPin}
                  makeDefault={addresses.length === 0}
                  onSaved={(saved) => {
                    setAdding(false);
                    loadAddresses(saved.id);
                  }}
                  onCancel={addresses.length ? () => setAdding(false) : undefined}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="mt-3 rounded-full bg-[var(--leaf-soft)] px-4 py-2 text-sm font-bold text-[var(--leaf-ink)] transition-colors hover:brightness-95"
                >
                  + Add a new address
                </button>
              )}
            </>
          )}
        </section>

        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] [animation-delay:100ms]">
          <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">How you will pay</h2>
          <div className="mt-3 grid gap-2.5">
            <PayOption
              id="cod"
              active={pay === 'cod'}
              onSelect={setPay}
              title="Cash on delivery"
              body="Pay the delivery partner when your order arrives."
            />
            <PayOption
              id="online"
              active={pay === 'online'}
              onSelect={setPay}
              title="Pay online"
              body="UPI, cards or net banking. You pay right after placing the order."
            />
          </div>

          {pay === 'online' && (
            <p className="mt-3 rounded-[18px] bg-warning/12 px-4 py-3 text-xs leading-relaxed font-medium text-[var(--text)] ring-1 ring-warning/35">
              You will pay securely on the next screen. The shop starts your order once the payment
              goes through, and you are refunded if they cannot take it.
            </p>
          )}
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Shops that only take online payment will ask for UPI even if you pick cash.
          </p>
        </section>

        <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] [animation-delay:140ms]">
          <h2 className="font-display text-base font-extrabold tracking-[-0.025em]">
            Anything the shop should know?
          </h2>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Less spicy, no onion, ring the bell twice..."
            className="mt-3 w-full resize-none rounded-[18px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] p-3.5 text-sm outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20"
          />
        </section>
      </div>

      <aside className="animate-rise sticky top-24 grid gap-4 rounded-[26px] bg-[var(--surface)] p-6 shadow-sm ring-1 ring-[var(--line)] [animation-delay:80ms]">
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">
          {groups.length === 1 ? 'Your order' : groups.length + ' orders'}
        </h2>

        <ul className="grid gap-2 text-sm">
          {groups.map((group) => (
            <li key={group.sellerId} className="flex justify-between gap-3">
              <span className="min-w-0 truncate text-[var(--text-muted)]">{group.sellerName}</span>
              <span className="shrink-0 font-bold tabular-nums">{formatRupees(group.subtotal)}</span>
            </li>
          ))}
        </ul>

        <dl className="grid gap-2 border-t border-[var(--line)] pt-3 text-sm">
          <Row label="Items" value={formatRupees(subtotal)} />
          <Row label="Delivery" value="Free" />
        </dl>

        <div className="flex items-baseline justify-between border-t border-[var(--line)] pt-3">
          <span className="font-bold">{pay === 'cod' ? 'Pay on delivery' : 'Pay online'}</span>
          <span className="font-display text-xl font-extrabold tabular-nums text-brand-600">
            {formatRupees(subtotal)}
          </span>
        </div>

        {problems.length > 0 && (
          <ul role="alert" className="grid gap-1.5 rounded-[16px] bg-danger/10 px-4 py-3 text-xs font-medium ring-1 ring-danger/30">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <Button size="lg" fullWidth onClick={placeAll} disabled={!canPlace} loading={placing}>
          Place {groups.length > 1 ? groups.length + ' orders' : 'order'}
        </Button>

        {!addressId && !adding && (
          <p className="text-center text-xs text-[var(--text-muted)]">Add a delivery address to continue.</p>
        )}
        {adding && (
          <p className="text-center text-xs text-[var(--text-muted)]">Save your address to continue.</p>
        )}
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function Radio({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-[1.5px]',
        active ? 'border-leaf-600 bg-leaf-600' : 'border-[var(--line)]'
      )}
    >
      {active && <span className="size-1.5 rounded-full bg-white" />}
    </span>
  );
}

function PayOption({
  id,
  active,
  onSelect,
  title,
  body
}: {
  id: PayChoice;
  active: boolean;
  onSelect: (value: PayChoice) => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={active}
      className={cn(
        'flex items-start gap-3 rounded-[18px] border-[1.5px] p-3.5 text-left transition-all duration-200',
        active
          ? 'border-leaf-500 bg-[var(--leaf-soft)]'
          : 'border-[var(--line)] hover:border-leaf-300 hover:bg-[var(--tile)]'
      )}
    >
      <Radio active={active} />
      <span>
        <span className="block text-sm font-bold">{title}</span>
        <span className="block text-xs leading-relaxed text-[var(--text-muted)]">{body}</span>
      </span>
    </button>
  );
}
