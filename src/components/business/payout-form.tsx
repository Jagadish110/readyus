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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-bold">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

/**
 * Bank details go to our server, which forwards them to Cashfree. They are
 * never kept here; after saving only the last four digits are shown.
 */
export function PayoutForm({ hasAccount, defaultName }: { hasAccount: boolean; defaultName: string }) {
  const router = useRouter();
  const [type, setType] = useState<'individual' | 'proprietorship'>('individual');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();

    if (text('accountNumber') !== text('accountNumberAgain')) {
      setError('The two account numbers do not match.');
      return;
    }

    setSaving(true);
    setError('');
    const response = await callPaymentsApi('/v1/seller/payout', {
      businessType: type,
      ...(hasAccount ? {} : { contactName: text('contactName'), pan: text('pan') }),
      beneficiaryName: text('beneficiaryName'),
      accountNumber: text('accountNumber'),
      ifsc: text('ifsc')
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
        Bank details sent for verification. We never keep your full account number.
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
        </div>
      )}

      <div className="grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
        <Field label="Account holder name" hint="Exactly as the bank has it.">
          <input name="beneficiaryName" required className={fieldClass} autoComplete="off" />
        </Field>
        <Field label="IFSC">
          <input
            name="ifsc"
            required
            maxLength={11}
            placeholder="HDFC0001234"
            className={fieldClass + ' uppercase'}
            autoComplete="off"
          />
        </Field>
        <Field label="Bank account number">
          <input
            name="accountNumber"
            required
            inputMode="numeric"
            pattern="[0-9]{9,18}"
            className={fieldClass}
            autoComplete="off"
          />
        </Field>
        <Field label="Confirm account number">
          <input
            name="accountNumberAgain"
            required
            inputMode="numeric"
            pattern="[0-9]{9,18}"
            className={fieldClass}
            autoComplete="off"
            onPaste={(event) => event.preventDefault()}
          />
        </Field>
      </div>

      {error && (
        <p role="alert" className="rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
          {error}
        </p>
      )}

      <Button type="submit" variant="leaf" size="lg" loading={saving} className="justify-self-start">
        {hasAccount ? 'Update bank details' : 'Save and verify'}
      </Button>
    </form>
  );
}
