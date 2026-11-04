'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callPaymentsApi } from '@/lib/payments/checkout';
import { Button } from '@/components/ui/button';

const fieldClass =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-base outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

type SellerType = 'individual' | 'business';

/** Only what Cashfree's documents list for each kind of seller. A sole proprietor has a personal PAN and no CIN. */
const SELLER_TYPES = [
  { value: 'individual', label: 'Individual', hint: 'You run the shop yourself, including sole proprietors.', needs: 'PAN and one ID proof' },
  { value: 'business', label: 'Business', hint: 'A registered company with a CIN.', needs: 'Business PAN and CIN' }
] as const;

/** The address proofs Cashfree accepts alongside the PAN. */
const ID_PROOFS = [
  { value: 'aadhaar', label: 'Aadhaar', placeholder: '1234 5678 9012' },
  { value: 'voter_id', label: 'Voter ID', placeholder: 'ABC1234567' },
  { value: 'driving_license', label: 'Driving licence', placeholder: 'KA0120198900984' },
  { value: 'passport', label: 'Passport', placeholder: 'A1234567' }
] as const;

type IdProof = (typeof ID_PROOFS)[number]['value'];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-bold">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

function CodeInput({ name, placeholder, maxLength, required }: { name: string; placeholder: string; maxLength: number; required?: boolean }) {
  return <input name={name} required={required} maxLength={maxLength} placeholder={placeholder} className={fieldClass + ' uppercase'} autoComplete="off" />;
}

/** Which ID and its number. Required on the first save, an optional fix afterwards. */
function IdProofFields({ idType, setIdType, required }: { idType: IdProof; setIdType: (value: IdProof) => void; required: boolean }) {
  const chosen = ID_PROOFS.find((proof) => proof.value === idType) ?? ID_PROOFS[0];
  return (
    <>
      <Field label={required ? 'ID proof' : 'ID proof (optional)'}>
        <select name="idProofType" value={idType} onChange={(event) => setIdType(event.target.value as IdProof)} className={fieldClass}>
          {ID_PROOFS.map((proof) => (
            <option key={proof.value} value={proof.value}>
              {proof.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`${chosen.label} number`} hint="As printed on the card.">
        <CodeInput name="idProofNumber" required={required} maxLength={20} placeholder={chosen.placeholder} />
      </Field>
    </>
  );
}

function UpiIdField({ required, hint }: { required: boolean; hint: string }) {
  return (
    <Field label="UPI ID" hint={hint}>
      <input
        name="upiId"
        required={required}
        placeholder="yourshop@okhdfcbank"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        pattern="[A-Za-z0-9._\-]{2,256}@[A-Za-z][A-Za-z0-9.\-]{1,63}"
        title="A UPI ID looks like yourshop@okhdfcbank"
        className={fieldClass + ' lowercase'}
        autoComplete="off"
      />
    </Field>
  );
}

/**
 * The UPI ID and KYC details go to our server, which forwards them to Cashfree. They are
 * never kept here; after saving only a masked UPI ID is shown.
 */
export function PayoutForm({ hasAccount, isBusiness = false }: { hasAccount: boolean; isBusiness?: boolean }) {
  const router = useRouter();
  const [type, setType] = useState<SellerType>('individual');
  const [idType, setIdType] = useState<IdProof>('aadhaar');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();

    setSaving(true);
    setError('');
    const response = await callPaymentsApi(
      '/v1/seller/payout',
      hasAccount
        ? {
            pan: text('pan'),
            ...(text('idProofNumber') ? { idProofType: idType, idProofNumber: text('idProofNumber') } : {}),
            cin: text('cin'),
            gstin: text('gstin'),
            upiHolder: text('upiHolder'),
            upiId: text('upiId')
          }
        : {
            businessType: type,
            // One name for both: on a first save the PAN and the UPI ID belong to the same person or company.
            contactName: text('name'),
            upiHolder: text('name'),
            pan: text('pan'),
            ...(type === 'individual' ? { idProofType: idType, idProofNumber: text('idProofNumber') } : { cin: text('cin') }),
            upiId: text('upiId')
          }
    );
    const result = response ? ((await response.json().catch(() => ({}))) as { error?: string }) : {};
    setSaving(false);

    if (!response || !response.ok) {
      setError(result.error ?? 'Could not reach the payment service. Try again in a moment.');
      return;
    }
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <p role="status" className="rounded-[18px] bg-success/12 p-4 text-sm font-medium ring-1 ring-success/35">
        Details sent to Cashfree for verification. We never keep your full UPI ID or ID numbers.
      </p>
    );
  }

  const chosen = SELLER_TYPES.find((option) => option.value === type) ?? SELLER_TYPES[0];

  return (
    <form onSubmit={submit} className="grid gap-4">
      {hasAccount ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
              Changing your UPI ID? Enter the new one here. Leave these empty to keep your current one.
            </p>
            <Field label="Name on the account" hint="The name your UPI app shows for this UPI ID.">
              <input name="upiHolder" className={fieldClass} autoComplete="off" />
            </Field>
            <UpiIdField required={false} hint="Cashfree checks it is real." />
          </div>

          <div className="grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
            <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
              Did Cashfree ask for a correction? Fill in only what it asked for.
            </p>
            <Field label="Corrected PAN (optional)">
              <CodeInput name="pan" maxLength={10} placeholder="ABCDE1234F" />
            </Field>
            {isBusiness ? (
              <>
                <Field label="CIN (optional)">
                  <CodeInput name="cin" maxLength={21} placeholder="U12345KA2020PTC123456" />
                </Field>
                <Field label="GSTIN (optional)">
                  <CodeInput name="gstin" maxLength={15} placeholder="29AAICP2912R1ZR" />
                </Field>
              </>
            ) : (
              <IdProofFields idType={idType} setIdType={setIdType} required={false} />
            )}
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Seller type">
            {SELLER_TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={type === option.value}
                onClick={() => setType(option.value)}
                className={
                  'rounded-[18px] border-[1.5px] p-3.5 text-left transition-all ' +
                  (type === option.value
                    ? 'border-leaf-500 bg-[var(--leaf-soft)]'
                    : 'border-[var(--line)] hover:border-leaf-300 hover:bg-[var(--tile)]')
                }
              >
                <span className="block text-sm font-bold">{option.label}</span>
                <span className="block text-xs leading-relaxed text-[var(--text-muted)]">{option.hint}</span>
              </button>
            ))}
          </div>

          <p className="text-sm text-[var(--text-muted)]">
            You&rsquo;ll need your <span className="font-bold text-[var(--text)]">{chosen.needs}</span>, and a UPI ID in the same name.
          </p>

          {/* Each kind of seller gets its own inputs, so nothing typed for one is sent for the other. */}
          <div key={type} className="grid gap-4 sm:grid-cols-2">
            <Field
              label={type === 'individual' ? 'Your name' : 'Business name'}
              hint={type === 'individual' ? 'As on your PAN and your UPI account.' : 'As on the business PAN and its UPI account.'}
            >
              <input name="name" required className={fieldClass} autoComplete={type === 'individual' ? 'name' : 'organization'} />
            </Field>
            <Field label={type === 'individual' ? 'PAN' : 'Business PAN'}>
              <CodeInput name="pan" required maxLength={10} placeholder="ABCDE1234F" />
            </Field>
            {type === 'individual' ? (
              <IdProofFields idType={idType} setIdType={setIdType} required />
            ) : (
              <Field label="CIN" hint="Corporate Identification Number, on your certificate of incorporation.">
                <CodeInput name="cin" required maxLength={21} placeholder="U12345KA2020PTC123456" />
              </Field>
            )}
            <UpiIdField required hint="Your earnings are paid to the bank account linked to this UPI ID. Cashfree checks it is real." />
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
          {error}
        </p>
      )}

      <Button type="submit" variant="leaf" size="lg" loading={saving} className="justify-self-start">
        {hasAccount ? 'Send to Cashfree' : 'Save and verify'}
      </Button>
    </form>
  );
}
