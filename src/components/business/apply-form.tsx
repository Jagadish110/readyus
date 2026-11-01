'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { api } from '@/lib/api/client';
import { DOCUMENT_TYPES, MAX_IMAGE_BYTES, uploadDocumentFile, uploadShopImage } from '@/lib/api/upload';
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
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [pin, setPin] = useState<Pin>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fssaiNumber, setFssaiNumber] = useState('');
  const [fssaiExpiry, setFssaiExpiry] = useState('');
  const [fssaiFile, setFssaiFile] = useState<File | null>(null);
  const [gstNumber, setGstNumber] = useState('');
  const [gstFile, setGstFile] = useState<File | null>(null);
  const [docsMissed, setDocsMissed] = useState<string[]>([]);
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

  // Food shops add their licence as part of the application; everyday-item shops stop after the place.
  const lastStep = mode === 'food' ? 3 : 2;

  function chooseDocument(file: File | undefined, set: (file: File | null) => void) {
    if (!file) return;
    if (!DOCUMENT_TYPES.includes(file.type)) return setError('Upload a PDF, JPG, PNG or WebP file.');
    if (file.size > MAX_IMAGE_BYTES) return setError('The file must be under 5 MB.');
    setError('');
    set(file);
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

  /** First problem with step 3 (food shops only), or null. */
  function problemInDocuments() {
    if (mode !== 'food') return null;
    if (!/^\d{14}$/.test(fssaiNumber.trim())) return 'Enter the 14-digit FSSAI number from your certificate.';
    if (!fssaiExpiry) return 'Enter the expiry date shown on your FSSAI certificate.';
    if (fssaiExpiry < new Date().toISOString().slice(0, 10)) return 'That FSSAI licence has expired. Renew it first.';
    if (!fssaiFile) return 'Upload your FSSAI certificate (PDF or photo).';
    if (gstNumber.trim() && !gstFile) return 'Upload your GST certificate, or clear the GSTIN.';
    if (gstFile && !/^[0-9A-Za-z]{15}$/.test(gstNumber.trim())) return 'Enter the 15-character GSTIN, or remove the GST file.';
    return null;
  }

  function next() {
    const problem = step === 1 ? problemInShop() : problemInPlace();
    if (problem) return setError(problem);
    setError('');
    setStep(step === 1 ? 2 : 3);
  }

  async function sendDocument(kind: 'fssai' | 'gst', file: File, number: string, validUntil?: string) {
    const uploaded = await uploadDocumentFile(kind, file);
    if (!uploaded.ok) return false;
    const saved = await api('POST', '/v1/seller/documents', {
      kind,
      number: number.trim(),
      path: uploaded.path,
      ...(kind === 'fssai' ? { validUntil } : {})
    });
    return saved.ok;
  }

  async function submit() {
    setError('');

    const problem = problemInShop() ?? problemInPlace() ?? problemInDocuments();
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

    // Documents go up after the application is saved, for the same reason as the photo: a failed
    // upload never costs the applicant their application. Anything that fails is listed on the
    // confirmation screen with a link to send it again.
    const missed: string[] = [];
    if (mode === 'food' && fssaiFile) {
      if (!(await sendDocument('fssai', fssaiFile, fssaiNumber, fssaiExpiry))) missed.push('FSSAI licence');
    }
    if (mode === 'food' && gstFile && gstNumber.trim()) {
      if (!(await sendDocument('gst', gstFile, gstNumber))) missed.push('GST certificate');
    }
    setDocsMissed(missed);

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
        <p className="mt-3 rounded-[18px] bg-[var(--tile)] px-4 py-3 text-left text-sm leading-relaxed text-[var(--text-muted)]">
          After approval you set up online payments on the Payouts page. Keep these ready: your PAN, one ID proof
          (Aadhaar, voter ID, driving licence or passport), and the bank account the money should go to.
        </p>
        {docsMissed.length === 0 && mode === 'food' ? (
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
            Your documents were received and will be checked with your application.
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
              {docsMissed.length
                ? `Your ${docsMissed.join(' and ')} could not be sent. Send it again so your shop can be approved.`
                : 'Next step: upload any verification documents you have.'}
            </p>
            <Link
              href="/business/documents"
              className="mt-5 inline-flex h-12 items-center rounded-full bg-leaf-600 px-7 text-[0.95rem] font-bold text-white shadow-[0_10px_26px_rgb(36_101_64/0.3)]"
            >
              Upload documents
            </Link>
          </>
        )}
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
        if (step < lastStep) return next();
        startTransition(() => {
          void submit();
        });
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">
          Step {step} of {lastStep} · {step === 1 ? 'Your shop' : step === 2 ? 'Where you are' : 'Documents'}
        </p>
        <span aria-hidden className="flex gap-1.5">
          {Array.from({ length: lastStep }, (_, index) => index + 1).map((n) => (
            <span
              key={n}
              className={cn('h-1.5 w-8 rounded-full transition-colors', n <= step ? 'bg-leaf-600' : 'bg-[var(--line)]')}
            />
          ))}
        </span>
      </div>

      {step === 1 && (
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

          <Field label="Shop name" value={shopName} onChange={setShopName} placeholder="Your shop's name" autoComplete="organization" />

          <label className="grid content-start gap-1.5">
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
      )}

      {step === 2 && (
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

      {step === 3 && (
        <>
          <p className="rounded-[18px] bg-[var(--leaf-soft)] px-4 py-3 text-sm leading-relaxed ring-1 ring-[var(--line)]">
            Indian law requires every food business to hold an FSSAI licence or registration. Your shop cannot be approved
            without it. Only our review team can open these files.
          </p>

          <div className="grid gap-4 rounded-[22px] border border-[var(--line)] p-4">
            <p className="text-xs font-bold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">FSSAI licence · Required</p>
            <Field
              label="FSSAI number"
              value={fssaiNumber}
              onChange={(value) => setFssaiNumber(value.replace(/\D/g, '').slice(0, 14))}
              placeholder="14 digits"
              inputMode="numeric"
              maxLength={14}
            />
            <label className="grid gap-1.5">
              <span className="text-[0.82rem] font-bold">Valid until</span>
              <input
                type="date"
                value={fssaiExpiry}
                onChange={(event) => setFssaiExpiry(event.target.value)}
                className={fieldClass}
              />
            </label>
            <DocumentPicker label="FSSAI certificate" file={fssaiFile} onChoose={(file) => chooseDocument(file, setFssaiFile)} />
          </div>

          <div className="grid gap-4 rounded-[22px] border border-[var(--line)] p-4">
            <p className="text-xs font-bold tracking-[0.14em] text-[var(--text-muted)] uppercase">GST registration · Optional</p>
            <Field
              label="GSTIN"
              value={gstNumber}
              onChange={(value) => setGstNumber(value.toUpperCase().slice(0, 15))}
              placeholder="15 characters, if you have GST"
              maxLength={15}
              autoCapitalize="characters"
            />
            <DocumentPicker label="GST certificate" file={gstFile} onChoose={(file) => chooseDocument(file, setGstFile)} />
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
        {step > 1 && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              setError('');
              setStep(step === 3 ? 2 : 1);
            }}
          >
            Back
          </Button>
        )}
        <Button type="submit" variant="leaf" size="lg" fullWidth loading={pending}>
          {step < lastStep ? 'Continue' : 'Submit application'}
        </Button>
      </div>
      <p className="text-center text-xs text-[var(--text-muted)]">
        Free for your first 30 days, then one flat monthly fee. We never take a commission on your sales.
      </p>
    </form>
  );
}

function DocumentPicker({
  label,
  file,
  onChoose
}: {
  label: string;
  file: File | null;
  onChoose: (file: File | undefined) => void;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[0.82rem] font-bold">{label}</span>
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={(event) => {
          onChoose(event.target.files?.[0]);
          event.target.value = '';
        }}
        className="block w-full rounded-[16px] border-[1.5px] border-dashed border-[var(--line)] bg-[var(--surface)] p-3 text-sm font-normal file:mr-3 file:rounded-full file:border-0 file:bg-[var(--leaf-soft)] file:px-4 file:py-2 file:font-bold file:text-[var(--leaf-ink)]"
      />
      <span className="text-xs font-normal text-[var(--text-muted)]">
        {file ? `Selected: ${file.name}` : 'PDF or clear photo, under 5 MB.'}
      </span>
    </label>
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
