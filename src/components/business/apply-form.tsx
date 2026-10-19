'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { PinIcon } from '@/components/shell/icons';
import { cn } from '@/lib/utils';

type Mode = 'food' | 'items';
type Pin = { lat: number; lng: number } | null;

const CATEGORY_HINTS: Record<Mode, string[]> = {
  food: ['Biryani & Kebabs', 'South Indian', 'Bakery & Beverages', 'Sweets', 'Home kitchen'],
  items: ['Grocery', 'Fruits & Vegetables', 'Household', 'Dairy', 'Stationery']
};

const fieldClass =
  'h-14 w-full rounded-[18px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-base outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

// The checked-in Database type does not describe functions or tables to
// supabase-js yet, so the two calls this form makes are typed here.
type Rpc = (
  name: string,
  args: Record<string, unknown>
) => PromiseLike<{ data: string | null; error: { message: string } | null }>;
type Table = {
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export function ApplyForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState<Mode>('food');
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Hyderabad');
  const [pincode, setPincode] = useState('');
  const [pin, setPin] = useState<Pin>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  function usePosition() {
    setError('');
    if (!('geolocation' in navigator)) {
      setError('This device cannot share a location.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        setError('We could not read your location. Allow access and try again.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }

  /** First problem with step 1, or null. */
  function problemInShop() {
    if (shopName.trim().length < 2) return 'Enter your shop name.';
    if (!category.trim()) return 'Say what you sell, for example South Indian.';
    if (!parsePhoneNumberFromString(phone, 'IN')?.isValid()) return 'Enter a valid mobile number.';
    return null;
  }

  /** First problem with step 2, or null. */
  function problemInPlace() {
    if (ownerName.trim().length < 2) return 'Enter the owner name.';
    if (address.trim().length < 5) return 'Enter the shop address.';
    if (!/^\d{6}$/.test(pincode.trim())) return 'Enter a 6-digit pincode.';
    if (!pin) return 'Pin your shop: stand at the shop and tap Use my location.';
    return null;
  }

  function next() {
    const problem = problemInShop();
    if (problem) return setError(problem);
    setError('');
    setStep(2);
  }

  async function submit() {
    setError('');
    if (!supabase) return setError('Sign-in is not available right now.');

    const problem = problemInShop() ?? problemInPlace();
    if (problem) return setError(problem);
    const parsed = parsePhoneNumberFromString(phone, 'IN');
    if (!parsed || !pin) return;

    const client = supabase as unknown as { rpc: Rpc; from: (table: string) => Table };

    const { data: sellerId, error: applyError } = await client.rpc('apply_to_sell', {
      p_shop_name: shopName.trim(),
      p_owner_name: ownerName.trim(),
      p_phone: parsed.number,
      p_category: category.trim(),
      p_listing_mode: mode,
      p_address: address.trim(),
      p_city: city.trim(),
      p_pincode: pincode.trim()
    });
    if (applyError || !sellerId) {
      return setError(
        applyError?.message === 'AUTH_REQUIRED'
          ? 'Please log in again, then resubmit.'
          : (applyError?.message ?? 'We could not save your application.')
      );
    }

    // A shop without a pin never appears to customers, so it is saved now.
    const { error: pinError } = await client
      .from('sellers')
      .update({ location: 'SRID=4326;POINT(' + pin.lng + ' ' + pin.lat + ')' })
      .eq('id', sellerId);
    if (pinError) {
      return setError('Your application was saved, but the map pin was not: ' + pinError.message);
    }

    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <section className="animate-rise py-4 text-center">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-[var(--leaf-soft)] text-3xl text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
          &#10003;
        </span>
        <h2 className="mt-5 font-display text-2xl font-extrabold tracking-[-0.035em]">Application sent</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          We review every shop before it goes live, and we will notify you the moment it is approved.
        </p>
      </section>
    );
  }

  return (
    <form
      className="animate-rise grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (step === 1) return next();
        startTransition(() => {
          void submit();
        });
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">
          Step {step} of 2 · {step === 1 ? 'Your shop' : 'Where you are'}
        </p>
        <span aria-hidden className="flex gap-1.5">
          {[1, 2].map((n) => (
            <span
              key={n}
              className={cn('h-1.5 w-8 rounded-full transition-colors', n <= step ? 'bg-leaf-600' : 'bg-[var(--line)]')}
            />
          ))}
        </span>
      </div>

      {step === 1 ? (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-full border border-[var(--line)] bg-[var(--tile)] p-1.5">
            {(['food', 'items'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setCategory('');
                }}
                className={cn(
                  'h-10 rounded-full text-sm font-bold transition-all duration-200',
                  mode === value
                    ? 'bg-[var(--surface)] text-[var(--leaf-ink)] shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                )}
              >
                {value === 'food' ? 'Food & drinks' : 'Everyday items'}
              </button>
            ))}
          </div>

          <Field label="Shop name" value={shopName} onChange={setShopName} placeholder="Sri Lakshmi Tiffin House" autoComplete="organization" />

          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-bold">Category</span>
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              list="shop-categories"
              placeholder={CATEGORY_HINTS[mode][0]}
              className={fieldClass}
            />
            <datalist id="shop-categories">
              {CATEGORY_HINTS[mode].map((hint) => (
                <option key={hint} value={hint} />
              ))}
            </datalist>
          </label>

          <Field label="Mobile number" value={phone} onChange={setPhone} placeholder="+91 98765 43210" type="tel" autoComplete="tel" />
        </>
      ) : (
        <>
          <Field label="Owner name" value={ownerName} onChange={setOwnerName} placeholder="Your full name" autoComplete="name" />
          <Field label="Shop address" value={address} onChange={setAddress} placeholder="Shop no., street, area" autoComplete="street-address" />
          <div className="grid grid-cols-[1fr_7.5rem] gap-3">
            <Field label="City" value={city} onChange={setCity} autoComplete="address-level2" />
            <Field label="Pincode" value={pincode} onChange={setPincode} placeholder="500001" inputMode="numeric" maxLength={6} autoComplete="postal-code" />
          </div>

          <div className="flex items-center gap-3 rounded-[18px] bg-[var(--leaf-soft)] p-3.5 ring-1 ring-[var(--line)]">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">{pin ? 'Shop pinned' : 'Pin your shop'}</p>
              <p className="text-xs leading-snug text-[var(--text-muted)]">
                {pin
                  ? pin.lat.toFixed(4) + ', ' + pin.lng.toFixed(4)
                  : 'Stand at the shop so customers nearby can find it.'}
              </p>
            </div>
            <Button type="button" variant="leaf-outline" size="sm" loading={locating} onClick={usePosition} className="shrink-0">
              <PinIcon className="size-4" />
              {pin ? 'Update' : 'Use my location'}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-[18px] bg-danger/12 px-4 py-3 text-sm font-medium text-[var(--text)] ring-1 ring-danger/35"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2.5">
        {step === 2 && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              setError('');
              setStep(1);
            }}
          >
            Back
          </Button>
        )}
        <Button type="submit" variant="leaf" size="lg" fullWidth loading={pending}>
          {step === 1 ? 'Continue' : 'Submit application'}
        </Button>
      </div>
      <p className="text-center text-xs text-[var(--text-muted)]">
        Free to list. We never take a commission on your sales.
      </p>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[0.82rem] font-bold">{label}</span>
      <input {...props} value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass} />
    </label>
  );
}
