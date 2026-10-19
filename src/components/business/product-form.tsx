'use client';

import { useMemo, useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { loose, type ProductRow } from '@/lib/business/db';
import type { Category } from '@/lib/business/categories';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const BUCKET = 'product-images';
const MAX_IMAGES = 4;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const fieldClass =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-base outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

const VEG_OPTIONS = [
  ['', 'Not specified'],
  ['veg', 'Vegetarian'],
  ['non_veg', 'Non-vegetarian'],
  ['egg', 'Contains egg'],
  ['vegan', 'Vegan'],
  ['jain', 'Jain']
] as const;
const SERVING_CHIPS = ['1 plate', 'Half plate', '1 piece', '1 bowl', '1 glass', '1 box'];
const UNIT_CHIPS = ['1 kg', '500 g', '250 g', '1 litre', '1 piece', '1 pack'];
const SPICE_OPTIONS = [
  ['', 'Not specified'],
  ['mild', 'Mild'],
  ['medium', 'Medium'],
  ['hot', 'Hot']
] as const;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-bold">
      {label}
      {children}
      {hint && <span className="text-xs font-medium text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

export function ProductForm({
  shopId,
  defaultMode,
  categories,
  product
}: {
  shopId: string;
  defaultMode: 'food' | 'items';
  categories: Category[];
  product?: ProductRow;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState<'food' | 'items'>(product?.listing_mode ?? defaultMode);
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [categoryKey, setCategoryKey] = useState(product?.category_key ?? '');
  const [price, setPrice] = useState(product ? String(Number(product.price)) : '');
  const [mrp, setMrp] = useState(product?.mrp != null ? String(Number(product.mrp)) : '');
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [vegType, setVegType] = useState(product?.veg_type ?? '');
  const [spice, setSpice] = useState(product?.spice_level ?? '');
  const [prep, setPrep] = useState(product?.prep_minutes != null ? String(product.prep_minutes) : '');
  const [quantity, setQuantity] = useState(product && product.stock > 0 && product.stock < 999 ? String(product.stock) : '20');
  const [inStock, setInStock] = useState(product ? product.available && product.stock > 0 : true);
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const modeCategories = categories.filter((category) => category.mode === mode);

  async function addImages(files: FileList | null) {
    if (!files || !supabase) return;
    setError('');
    const room = MAX_IMAGES - images.length;
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) setError(`A product can have up to ${MAX_IMAGES} photos.`);

    setUploading(true);
    const added: string[] = [];
    for (const file of picked) {
      const extension = TYPES[file.type];
      if (!extension) {
        setError('Photos must be JPG, PNG or WebP.');
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError('Each photo must be under 5 MB.');
        continue;
      }
      // The first path segment is the shop id: storage policy only lets a shop
      // write inside its own folder.
      const path = `${shopId}/${crypto.randomUUID()}.${extension}`;
      const bucket = loose(supabase).storage.from(BUCKET);
      const { error: uploadError } = await bucket.upload(path, file, {
        contentType: file.type,
        upsert: false
      });
      if (uploadError) {
        setError(uploadError.message);
        continue;
      }
      added.push(bucket.getPublicUrl(path).data.publicUrl);
    }
    setImages((current) => [...current, ...added]);
    setUploading(false);
  }

  function removeImage(url: string) {
    setImages((current) => current.filter((item) => item !== url));
  }

  /** First problem with the form, or null. */
  function problem() {
    if (name.trim().length < 2) return 'Enter the product name.';
    if (!categoryKey) return 'Choose a category.';
    const p = Number(price);
    if (price === '' || !Number.isFinite(p) || p < 0) return 'Enter a valid price.';
    if (mrp !== '') {
      const m = Number(mrp);
      if (!Number.isFinite(m) || m < p) return 'MRP cannot be lower than the price.';
    }
    if (mode === 'items') {
      const q = Number(quantity);
      if (!Number.isInteger(q) || q < 0) return 'Quantity in stock must be a whole number, 0 or more.';
      if (!unit.trim()) return 'Choose how it is sold, like 1 kg or 1 pack.';
    }
    if (prep !== '' && (!Number.isInteger(Number(prep)) || Number(prep) < 0)) {
      return 'Preparation time must be whole minutes.';
    }
    return null;
  }

  async function submit() {
    setError('');
    if (!supabase) return setError('Saving is not available right now.');
    const issue = problem();
    if (issue) return setError(issue);

    const values = {
      name: name.trim(),
      description: description.trim(),
      category_key: categoryKey,
      listing_mode: mode,
      price: Number(price),
      mrp: mrp === '' ? null : Number(mrp),
      unit: unit.trim(),
      // No counting: the in-stock switch is all a kitchen needs. Customers see
      // sold out at 0 and can order freely above it.
      stock: mode === 'items' ? Number(quantity) : inStock ? 999 : 0,
      images,
      veg_type: mode === 'food' ? vegType : '',
      spice_level: mode === 'food' ? spice : '',
      prep_minutes: mode === 'food' && prep !== '' ? Number(prep) : null,
      available: true
    };

    const table = loose(supabase).from('products');
    // New rows are approved by the column default (migration 0013); the
    // seller has no grant on that column.
    const { error: saveError } = product
      ? await table.update(values).eq('id', product.id)
      : await table.insert({ ...values, seller_id: shopId });
    if (saveError) return setError(saveError.message);

    router.push('/business/products');
    router.refresh();
  }

  const food = mode === 'food';

  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => {
          void submit();
        });
      }}
    >
      <Card className="grid gap-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Photos</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((url) => (
            <li key={url} className="relative aspect-square overflow-hidden rounded-[18px] bg-[var(--tile)]">
              <Image src={url} alt="Product photo" fill unoptimized sizes="160px" className="object-cover" />
              <button
                type="button"
                onClick={() => removeImage(url)}
                aria-label="Remove photo"
                className="absolute top-1.5 right-1.5 grid size-8 place-items-center rounded-full bg-black/60 text-lg leading-none text-white"
              >
                ×
              </button>
            </li>
          ))}
          {images.length < MAX_IMAGES && (
            <li>
              <label
                className={cn(
                  'grid aspect-square cursor-pointer place-items-center rounded-[18px] border-[1.5px] border-dashed',
                  'border-leaf-300 bg-[var(--leaf-soft)] text-center text-sm font-bold text-[var(--leaf-ink)]',
                  'focus-within:ring-4 focus-within:ring-leaf-500/20'
                )}
              >
                {uploading ? 'Uploading…' : '+ Add photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={uploading}
                  className="sr-only"
                  onChange={(event) => {
                    void addImages(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
            </li>
          )}
        </ul>
        <p className="text-xs text-[var(--text-muted)]">Up to {MAX_IMAGES} photos · JPG, PNG or WebP · 5 MB each</p>
      </Card>

      <Card className="grid gap-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Details</h2>

        <div className="grid grid-cols-2 gap-1 rounded-full border border-[var(--line)] bg-[var(--tile)] p-1.5">
          {(['food', 'items'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setCategoryKey('');
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

        <Field label="Name">
          <input className={fieldClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea
            className={cn(fieldClass, 'h-28 py-3')}
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Category">
          <select className={fieldClass} value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
            <option value="">Choose…</option>
            {modeCategories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card className="grid gap-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Price &amp; serving</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹)">
            <input className={fieldClass} type="number" inputMode="decimal" min={0} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="MRP (₹)" hint="Optional">
            <input className={fieldClass} type="number" inputMode="decimal" min={0} step="0.5" value={mrp} onChange={(e) => setMrp(e.target.value)} />
          </Field>
          <div className="col-span-2 grid gap-2">
            <span className="text-sm font-bold">{food ? 'Serving size' : 'Unit'}</span>
            <div className="flex flex-wrap gap-2">
              {(food ? SERVING_CHIPS : UNIT_CHIPS).map((chip) => (
                <button
                  key={chip}
                  type="button"
                  aria-pressed={unit === chip}
                  onClick={() => setUnit(chip)}
                  className={cn(
                    'rounded-full px-3.5 py-1.5 text-xs font-bold ring-1 transition-colors',
                    unit === chip
                      ? 'bg-leaf-600 text-white ring-leaf-600'
                      : 'bg-[var(--surface)] text-[var(--leaf-ink)] ring-[var(--line)] hover:bg-[var(--leaf-soft)]'
                  )}
                >
                  {chip}
                </button>
              ))}
            </div>
            <input
              className={fieldClass}
              value={unit}
              maxLength={24}
              placeholder={food ? 'Or type your own, like 1 full plate' : 'Or type your own'}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
        </div>
        {food && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Diet">
              <select className={fieldClass} value={vegType} onChange={(e) => setVegType(e.target.value)}>
                {VEG_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Spice level">
              <select className={fieldClass} value={spice} onChange={(e) => setSpice(e.target.value)}>
                {SPICE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Prep time (min)">
              <input className={fieldClass} type="number" inputMode="numeric" min={0} step={1} value={prep} onChange={(e) => setPrep(e.target.value)} />
            </Field>
          </div>
        )}
        {!food && (
          <Field label="Quantity in stock" hint="Counts down as customers order. At 0 it shows as sold out; add more any time.">
            <input
              className={fieldClass}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
        )}
        {food && (
        <label className="flex items-center justify-between gap-4 rounded-[18px] bg-[var(--tile)] p-4 text-sm font-bold">
          <span>
            In stock
            <span className="block text-xs font-medium text-[var(--text-muted)]">
              Turn off when it runs out. Customers will see it as sold out.
            </span>
          </span>
          <input
            type="checkbox"
            checked={inStock}
            onChange={(e) => setInStock(e.target.checked)}
            className="size-6 accent-[var(--color-leaf-600)]"
          />
        </label>
        )}
      </Card>

      {error && (
        <p role="alert" className="rounded-[18px] bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="leaf" loading={pending} disabled={uploading}>
          {product ? 'Save changes' : 'Add to menu'}
        </Button>
        <ButtonLink href="/business/products" variant="leaf-outline">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
