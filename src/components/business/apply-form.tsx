'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { api } from '@/lib/api/client';
import { uploadShopImage } from '@/lib/api/upload';
import { friendlyError } from '@/lib/orders/errors';
import { Button } from '@/components/ui/button';
import { PinIcon } from '@/components/shell/icons';
import { cn } from '@/lib/utils';

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

type Mode = 'food' | 'items';
type Pin = { lat: number; lng: number } | null;

const CATEGORY_HINTS: Record<Mode, string[]> = {
  food: ['Biryani & Kebabs', 'South Indian', 'Bakery & Beverages', 'Sweets', 'Home kitchen'],
  items: ['Grocery', 'Fruits & Vegetables', 'Household', 'Dairy', 'Stationery']
};

const fieldClass =
  'h-14 w-full rounded-[18px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-base outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

export function ApplyForm() {
  const router = useRouter();
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
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoMissed, setPhotoMissed] = useState(false);

  // The preview is a blob URL, which has to be released when it is replaced.
  useEffect(() => {
    if (!photo) {
      setPhotoUrl('');
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (!PHOTO_TYPES[file.type]) return setError('The photo must be a JPG, PNG or WebP.');
    if (file.size > PHOTO_MAX_BYTES) return setError('The photo must be under 5 MB.');
    setError('');
    setPhoto(file);
  }

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

    const problem = problemInShop() ?? problemInPlace();
    if (problem) return setError(problem);
    const parsed = parsePhoneNumberFromString(phone, 'IN');
    if (!parsed || !pin) return;

    // One request: the application and the map pin are saved together.
    const applied = await api<{ sellerId: string }>('POST', '/v1/seller/apply', {
      shopName: shopName.trim(),
      ownerName: ownerName.trim(),
      phone: parsed.number,
      category: category.trim(),
      listingMode: mode,
      address: address.trim(),
      city: city.trim(),
      pincode: pincode.trim(),
      lat: pin.lat,
      lng: pin.lng
    });
    if (!applied.ok) {
      return setError(
        applied.error === 'AUTH_REQUIRED' || applied.status === 401
          ? 'Please log in again, then resubmit.'
          : friendlyError(applied.error) || 'We could not save your application.'
      );
    }

    // The photo is optional and goes up last, so a failed upload never costs
    // the applicant their application.
    if (photo) {
      const uploaded = await uploadShopImage('shop', photo);
      if (!uploaded.ok) {
        setPhotoMissed(true);
      } else {
        const attached = await api('POST', '/v1/seller/shop/photo', { url: uploaded.url });
        if (!attached.ok) setPhotoMissed(true);
      }
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
        {photoMissed && (
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
            Your shop photo could not be uploaded. Everything else was saved.
          </p>
        )}
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

          <div className="grid gap-1.5">
            <span className="text-[0.82rem] font-bold">Restaurant or shop photo</span>
            <label className="group relative flex aspect-[16/9] cursor-pointer items-center justify-center overflow-hidden rounded-[22px] border-[1.5px] border-dashed border-leaf-300 bg-[var(--leaf-soft)] text-center text-sm font-bold text-[var(--leaf-ink)] focus-within:ring-4 focus-within:ring-leaf-500/20">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="Your shop" className="absolute inset-0 size-full object-cover" />
              ) : (
                <span className="grid gap-1 px-6">
                  <span className="text-2xl leading-none">+</span>
                  Add a photo of your shop or best dish
                  <span className="text-xs font-medium text-[var(--text-muted)]">Optional · JPG, PNG or WebP · 5 MB</span>
                </span>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => {
                  choosePhoto(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {photoUrl && (
                <span className="absolute right-3 bottom-3 rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white">
                  Change photo
                </span>
              )}
            </label>
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
