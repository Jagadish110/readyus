'use client';

import { useState } from 'react';
import { api } from '@/lib/api/client';
import { friendlyError } from '@/lib/orders/errors';
import type { MyReview, OrderItem } from '@/lib/orders/load';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function StarInput({
  value,
  onChange,
  label
}: {
  value: number;
  onChange: (rating: number) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
          onClick={() => onChange(star)}
          className={cn(
            'grid size-9 place-items-center rounded-full text-xl leading-none transition-transform active:scale-90',
            star <= value ? 'text-saffron-500' : 'text-ink-300'
          )}
        >
          &#9733;
        </button>
      ))}
    </div>
  );
}

type Props = {
  orderId: string;
  shopName: string;
  items: OrderItem[];
  existing: MyReview[];
  onSaved: () => void;
};

/** One to five stars for the shop and for each item, written through submit_review. */
export function ReviewForm({ orderId, shopName, items, existing, onSaved }: Props) {
  const shopBefore = existing.find((review) => review.product_id === null)?.rating ?? 0;
  const [shop, setShop] = useState(shopBefore);
  const [byProduct, setByProduct] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      existing.filter((review) => review.product_id).map((review) => [review.product_id as string, review.rating])
    )
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const rated = items.filter((item) => item.product_id);
  const already = existing.length > 0;

  async function submit() {
    setError('');
    if (!shop && !Object.values(byProduct).some(Boolean)) {
      return setError('Tap the stars to rate something first.');
    }
    setSaving(true);
    const result = await api('POST', `/v1/orders/${orderId}/review`, {
      shopRating: shop || null,
      items: Object.entries(byProduct)
        .filter(([, rating]) => rating > 0)
        .map(([product_id, rating]) => ({ product_id, rating, body: '' }))
    });
    setSaving(false);

    if (!result.ok) return setError(friendlyError(result.error));
    setSaved(true);
    onSaved();
  }

  return (
    <section className="animate-rise rounded-[26px] bg-[var(--surface)] p-5 shadow-sm ring-1 ring-[var(--line)] sm:p-6">
      <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">
        {already ? 'Your ratings' : 'How was it?'}
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Ratings are public and help neighbours choose. You can change them later.
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[18px] bg-[var(--tile)] p-3.5">
        <span className="text-sm font-bold">{shopName}</span>
        <StarInput value={shop} onChange={setShop} label={`Rate ${shopName}`} />
      </div>

      <ul className="mt-3 grid gap-2">
        {rated.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-[var(--line)] p-3.5"
          >
            <span className="min-w-0 text-sm font-semibold">{item.name}</span>
            <StarInput
              value={byProduct[item.product_id as string] ?? 0}
              onChange={(rating) => setByProduct((current) => ({ ...current, [item.product_id as string]: rating }))}
              label={`Rate ${item.name}`}
            />
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="mt-3 rounded-[16px] bg-danger/10 px-4 py-3 text-sm font-medium ring-1 ring-danger/30">
          {error}
        </p>
      )}
      {saved && <p className="mt-3 text-sm font-bold text-[var(--leaf-ink)]">Thanks, your ratings are saved.</p>}

      <Button variant="leaf" className="mt-4" onClick={submit} loading={saving}>
        {already ? 'Update ratings' : 'Submit ratings'}
      </Button>
    </section>
  );
}
