'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callPaymentsApi } from '@/lib/payments/checkout';
import { Button } from '@/components/ui/button';

const fieldClass =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-base outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

const BUSINESS_TYPES = [
  { value: 'individual', label: 'Individual', hint: 'You run the shop yourself, no registered firm.' },
  { value: 'proprietorship', label: 'Proprietorship', hint: 'A sole-owner business, with or without GST.' }
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

/** Which ID and its number. Required on the first save, an optional fix afterwards. */
function IdProofFields({ idType, setIdType, required }: { idType: IdProof; setIdType: (value: IdProof) => void; required: boolean }) {
  const chosen = ID_PROOFS.find((proof) => proof.value === idType) ?? ID_PROOFS[0];
  return (
    <>
      <Field label={required ? 'ID proof' : 'ID proof (optional)'} hint="Cashfree needs one besides the PAN.">
        <select
          name="idProofType"
          value={idType}
          onChange={(event) => setIdType(event.target.value as IdProof)}
          className={fieldClass}
        >
          {ID_PROOFS.map((proof) => (
            <option key={proof.value} value={proof.value}>
              {proof.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={`${chosen.label} number`} hint="As printed on the card.">
        <input
          name="idProofNumber"
          required={required}
          maxLength={20}
          placeholder={chosen.placeholder}
          className={fieldClass + ' uppercase'}
          autoComplete="off"
        />
      </Field>
    </>
  );
}

/**
 * The UPI ID and KYC details go to our server, which forwards them to Cashfree. They are
 * never kept here; after saving only a masked UPI ID is shown.
 */
export function PayoutForm({ hasAccount, defaultName }: { hasAccount: boolean; defaultName: string }) {
  const router = useRouter();
  const [type, setType] = useState<'individual' | 'proprietorship'>('individual');
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
    const response = await callPaymentsApi('/v1/seller/payout', {
      businessType: type,
      ...(hasAccount ? { pan: text('pan') } : { contactName: text('contactName'), pan: text('pan') }),
      ...(text('idProofNumber') ? { idProofType: idType, idProofNumber: text('idProofNumber') } : {}),
      gstin: text('gstin'),
      upiHolder: text('upiHolder'),
      upiId: text('upiId')
    });
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

  return (
    <form onSubmit={submit} className="grid gap-4">
      {!hasAccount && (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Business type">
          {BUSINESS_TYPES.map((option) => (
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
      )}

      {!hasAccount && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner name" hint="As on your PAN card.">
            <input name="contactName" required defaultValue={defaultName} className={fieldClass} autoComplete="name" />
          </Field>
          <Field label="PAN" hint="Of the owner or the business.">
            <input
              name="pan"
              required
              maxLength={10}
              placeholder="ABCDE1234F"
              className={fieldClass + ' uppercase'}
              autoComplete="off"
            />
          </Field>
          <IdProofFields idType={idType} setIdType={setIdType} required />
          {type === 'proprietorship' && (
            <Field label="GSTIN (optional)" hint="Add it if your business is registered for GST.">
              <input name="gstin" maxLength={15} placeholder="29AAICP2912R1ZR" className={fieldClass + ' uppercase'} autoComplete="off" />
            </Field>
          )}
        </div>
      )}

      {hasAccount && (
        <div className="grid gap-4">
          <p className="text-sm text-[var(--text-muted)]">
            Fix only what Cashfree asked for. Leave the rest empty.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Corrected PAN (optional)" hint="Only fill this if Cashfree said the PAN is invalid.">
              <input
                name="pan"
                maxLength={10}
                placeholder="ABCDE1234F"
                className={fieldClass + ' uppercase'}
                autoComplete="off"
              />
            </Field>
            <Field label="GSTIN (optional)" hint="Only if your business is registered for GST.">
              <input name="gstin" maxLength={15} placeholder="29AAICP2912R1ZR" className={fieldClass + ' uppercase'} autoComplete="off" />
            </Field>
            <IdProofFields idType={idType} setIdType={setIdType} required={false} />
          </div>
        </div>
      )}

      <div className="grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
        {hasAccount && (
          <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
            Changing your UPI ID? Enter the new one below. Leave these empty to keep your current one.
          </p>
        )}
        <Field label="Name on the account" hint="The name your UPI app shows for this UPI ID.">
          <input name="upiHolder" required={!hasAccount} className={fieldClass} autoComplete="off" />
        </Field>
        <Field label="UPI ID" hint="Find it in your UPI app, under your profile. Cashfree checks it is real.">
          <input
            name="upiId"
            required={!hasAccount}
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
        <p className="text-xs leading-relaxed text-[var(--text-muted)] sm:col-span-2">
          Your earnings are paid to the bank account linked to this UPI ID. Use the UPI ID of the shop owner or the
          business, not someone else&rsquo;s.
        </p>
      </div>

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
