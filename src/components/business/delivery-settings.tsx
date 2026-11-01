'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import type { ShopRow } from '@/lib/business/db';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const fieldClass =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] pr-4 pl-9 text-base outline-none transition-all focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

/** A rupee amount: empty or 0 both mean "none". */
function RupeeField({
  label,
  hint,
  value,
  onChange
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid content-start gap-1.5 text-sm font-bold">
      {label}
      <span className="relative">
        <span aria-hidden className="absolute top-1/2 left-4 -translate-y-1/2 font-bold text-[var(--text-muted)]">
          ₹
        </span>
        <input
          className={fieldClass}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          placeholder="0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      <span className="text-xs font-medium text-[var(--text-muted)]">{hint}</span>
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-bold">{label}</p>
        <p className="text-xs text-[var(--text-muted)]">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-8 w-14 shrink-0 rounded-full transition-colors before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[""]',
          checked ? 'bg-leaf-600' : 'bg-ink-300'
        )}
      >
        <span className={cn('absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform', checked && 'translate-x-6')} />
      </button>
    </div>
  );
}

const asText = (value: number | string) => (Number(value) > 0 ? String(Number(value)) : '');
const asRupees = (text: string) => (text.trim() === '' ? 0 : Number(text));

/** What delivery costs, the smallest order the shop takes, and how customers can pay. */
export function DeliverySettings({ shop, onlineReady }: { shop: ShopRow; onlineReady: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fee, setFee] = useState(asText(shop.delivery_fee));
  const [freeAbove, setFreeAbove] = useState(asText(shop.free_delivery_above));
  const [minOrder, setMinOrder] = useState(asText(shop.min_order_amount));
  const [prepaid, setPrepaid] = useState(shop.prepaid_available);
  const [cod, setCod] = useState(shop.cod_available);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  function save() {
    const values = { delivery_fee: asRupees(fee), free_delivery_above: asRupees(freeAbove), min_order_amount: asRupees(minOrder) };
    if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0)) {
      return setMessage({ tone: 'error', text: 'Amounts must be 0 or more.' });
    }
    if (!prepaid && !cod) {
      return setMessage({ tone: 'error', text: 'Keep at least one way to pay switched on.' });
    }
    startTransition(async () => {
      const result = await api('POST', '/v1/seller/shop/settings', {
        ...values,
        prepaid_available: prepaid,
        cod_available: cod
      });
      if (!result.ok) return setMessage({ tone: 'error', text: result.error });
      setMessage({ tone: 'ok', text: 'Delivery and payment settings saved.' });
      router.refresh();
    });
  }

  const feeNumber = asRupees(fee);
  const freeNumber = asRupees(freeAbove);
  const summary =
    feeNumber > 0
      ? `Customers pay ₹${feeNumber} for delivery${freeNumber > 0 ? `, free on orders of ₹${freeNumber} or more` : ''}.`
      : 'Delivery is free on every order.';

  return (
    <Card className="grid gap-5 p-5 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Delivery and payments</h2>
        <p className="text-sm text-[var(--text-muted)]">Customers see these on your shop page and at checkout.</p>
      </div>

      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <RupeeField label="Delivery charge" hint="Leave empty for free delivery." value={fee} onChange={setFee} />
          <RupeeField
            label="Free delivery above"
            hint="Orders this big deliver free. Empty: never."
            value={freeAbove}
            onChange={setFreeAbove}
          />
          <RupeeField label="Minimum order" hint="Smaller orders cannot be placed. Empty: none." value={minOrder} onChange={setMinOrder} />
        </div>
        <p className="rounded-[16px] bg-[var(--tile)] px-4 py-3 text-sm font-medium">{summary}</p>

        <hr className="border-[var(--line)]" />

        <div className="grid gap-4">
          <Toggle
            label="Online payment (prepaid)"
            hint={onlineReady ? 'UPI, cards and net banking, straight to your bank.' : 'Add your bank details on Payouts to take online payments.'}
            checked={prepaid}
            onChange={setPrepaid}
          />
          <Toggle
            label="Cash on delivery"
            hint="Your rider collects the money at the door."
            checked={cod}
            onChange={setCod}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="leaf" size="sm" loading={pending}>
            Save delivery and payments
          </Button>
          {message && (
            <p
              role="status"
              className={cn('text-sm font-semibold', message.tone === 'ok' ? 'text-[var(--leaf-ink)]' : 'text-danger')}
            >
              {message.text}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
