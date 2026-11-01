'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { uploadShopImage } from '@/lib/api/upload';
import type { ProductRow } from '@/lib/business/db';
import type { Category } from '@/lib/business/categories';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { comboSummary, variantNoun } from '@/lib/menu';
import { cn } from '@/lib/utils';

const MAX_IMAGES = 4;

const fieldClass =
  'h-12 w-full rounded-[16px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-3.5 text-base outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20';

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
    <label className="grid content-start gap-1.5 text-sm font-bold">
      {label}
      {children}
      {hint && <span className="text-xs font-medium text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

export function ProductForm({
  defaultMode,
  categories,
  product,
  menu = []
}: {
  defaultMode: 'food' | 'items';
  categories: Category[];
  product?: ProductRow;
  /** The shop's other products, to pick from when this one is a combo. */
  menu?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
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
  // Sizes keep their ids across edits: a customer's cart names the size by id.
  const [variants, setVariants] = useState<Array<{ id?: string; label: string; price: string }>>(
    (product?.variants ?? []).map((variant) => ({ id: variant.id, label: variant.label, price: String(Number(variant.price)) }))
  );
  const [variantName, setVariantName] = useState(product?.variant_name ?? 'Size');
  // A combo is a product that lists what it includes; the price below is the combo's own.
  const [isCombo, setIsCombo] = useState((product?.combo_items?.length ?? 0) > 0);
  const [comboItems, setComboItems] = useState<ComboDraft[]>(
    (product?.combo_items ?? []).map((item) => ({ name: item.name, qty: String(item.qty) }))
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const modeCategories = categories.filter((category) => category.mode === mode);

  function toggleCombo(on: boolean) {
    setIsCombo(on);
    // With a menu to pick from, the list starts empty; otherwise two blank lines to type into.
    if (on && comboItems.length === 0 && menu.length === 0) setComboItems([{ name: '', qty: '1' }, { name: '', qty: '1' }]);
    if (on && !categoryKey && modeCategories.some((category) => category.key === 'combos')) setCategoryKey('combos');
  }

  async function addImages(files: FileList | null) {
    if (!files) return;
    setError('');
    const room = MAX_IMAGES - images.length;
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) setError(`A product can have up to ${MAX_IMAGES} photos.`);

    setUploading(true);
    const added: string[] = [];
    for (const file of picked) {
      // The backend picks the path inside this shop's own folder and checks the type.
      const result = await uploadShopImage('product', file);
      if (result.ok) added.push(result.url);
      else setError(result.error);
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
    if (isCombo) {
      if (comboItems.length === 0) return 'Add what is in the combo, like 1 Pizza Mania and 1 Coke.';
      if (comboItems.some((item) => !item.name.trim())) return 'Name each item in the combo.';
      if (comboItems.some((item) => !Number.isInteger(Number(item.qty)) || Number(item.qty) < 1 || Number(item.qty) > 20)) {
        return 'Each item in the combo needs a quantity from 1 to 20.';
      }
    }
    if (variants.length) {
      const noun = variantNoun(variantName);
      if (!variantName.trim()) return 'Say what the variants are, like Size or Flavour.';
      if (variants.some((variant) => !variant.label.trim())) return `Name each ${noun}.`;
      if (variants.some((variant) => variant.price === '' || !Number.isFinite(Number(variant.price)) || Number(variant.price) < 0)) {
        return `Enter a price for each ${noun}.`;
      }
      const labels = variants.map((variant) => variant.label.trim().toLowerCase());
      if (new Set(labels).size !== labels.length) return `Each ${noun} needs a different name.`;
    } else {
      const p = Number(price);
      if (price === '' || !Number.isFinite(p) || p < 0) return 'Enter a valid price.';
      if (mrp !== '') {
        const m = Number(mrp);
        if (!Number.isFinite(m) || m < p) return 'MRP cannot be lower than the price.';
      }
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
    const issue = problem();
    if (issue) return setError(issue);

    const values = {
      name: name.trim(),
      description: description.trim(),
      category_key: categoryKey,
      listing_mode: mode,
      // With sizes, the backend lists the cheapest size as the price.
      price: variants.length ? Math.min(...variants.map((variant) => Number(variant.price))) : Number(price),
      mrp: variants.length || mrp === '' ? null : Number(mrp),
      variants: variants.map((variant) => ({
        ...(variant.id ? { id: variant.id } : {}),
        label: variant.label.trim(),
        price: Number(variant.price)
      })),
      variant_name: variantName.trim() || 'Size',
      combo_items: isCombo ? comboItems.map((item) => ({ name: item.name.trim(), qty: Number(item.qty) })) : [],
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

    // The backend scopes this to the signed-in owner's shop; the shop id is never sent from here.
    const saved = await api('POST', product ? `/v1/seller/products/${product.id}` : '/v1/seller/products', values);
    if (!saved.ok) return setError(saved.error);

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
                className="absolute top-1 right-1 grid size-10 place-items-center rounded-full bg-black/60 text-xl leading-none text-white"
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
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block font-display text-lg font-extrabold tracking-[-0.03em]">Combo</span>
            <span className="block text-xs font-medium text-[var(--text-muted)]">
              One price for several products together, like a pizza with a Coke.
            </span>
          </span>
          <button
            type="button"
            aria-pressed={isCombo}
            onClick={() => toggleCombo(!isCombo)}
            className={cn(
              'h-11 shrink-0 rounded-full px-5 text-sm font-extrabold tracking-wide ring-1 transition-colors active:scale-[0.97]',
              isCombo
                ? 'bg-leaf-600 text-white ring-leaf-600'
                : 'bg-[var(--surface)] text-[var(--leaf-ink)] ring-[var(--line)] hover:bg-[var(--leaf-soft)]'
            )}
          >
            {isCombo ? '✓ COMBO' : '+ COMBO'}
          </button>
        </div>
        {isCombo && <ComboEditor items={comboItems} onChange={setComboItems} menu={menu} />}
      </Card>

      <Card className="grid gap-4 p-5 sm:p-6">
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Price &amp; serving</h2>
        <div className="grid grid-cols-2 gap-3">
          {variants.length === 0 ? (
            <>
              <Field label="Price (₹)">
                <input className={fieldClass} type="number" inputMode="decimal" min={0} step="0.5" value={price} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <Field
                label={isCombo ? 'Bought separately (₹)' : 'MRP (₹)'}
                hint={isCombo ? 'Optional. Shows how much the combo saves.' : 'Optional'}
              >
                <input className={fieldClass} type="number" inputMode="decimal" min={0} step="0.5" value={mrp} onChange={(e) => setMrp(e.target.value)} />
              </Field>
            </>
          ) : (
            <p className="col-span-2 rounded-[16px] bg-[var(--tile)] px-4 py-3 text-sm font-medium">
              The price comes from the variants below. Your menu shows the cheapest one as &ldquo;from&rdquo;.
            </p>
          )}

          <SizesEditor
            variants={variants}
            onChange={setVariants}
            food={food}
            variantName={variantName}
            onVariantName={setVariantName}
          />

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
                    'h-10 rounded-full px-4 text-xs font-bold ring-1 transition-colors',
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

type SizeDraft = { id?: string; label: string; price: string };
type ComboDraft = { name: string; qty: string };

/** Common size sets, so a typical menu takes one tap. */
const SIZE_PRESETS: Record<'food' | 'items', string[][]> = {
  food: [['Half', 'Full'], ['Small', 'Medium', 'Large'], ['Regular', 'Large']],
  items: [['250 g', '500 g', '1 kg'], ['500 ml', '1 L'], ['Small pack', 'Large pack']]
};

/** What variants are usually called. Customers see "Choose your …" with this word. */
const VARIANT_NAMES: Record<'food' | 'items', string[]> = {
  food: ['Size', 'Flavour', 'Pizza', 'Portion'],
  items: ['Size', 'Pack', 'Flavour']
};

/**
 * Variants of one product, each with its own price: sizes (Half ₹180 / Full ₹300) or choices
 * (Cheese Onion / Paneer). Optional: a product without them has a single price. They share its stock.
 */
function SizesEditor({
  variants,
  onChange,
  food,
  variantName,
  onVariantName
}: {
  variants: SizeDraft[];
  onChange: (next: SizeDraft[]) => void;
  food: boolean;
  variantName: string;
  onVariantName: (name: string) => void;
}) {
  const update = (index: number, change: Partial<SizeDraft>) =>
    onChange(variants.map((variant, at) => (at === index ? { ...variant, ...change } : variant)));
  const noun = variantNoun(variantName);
  const isSize = noun === 'size';

  return (
    <div className="col-span-2 grid gap-3 rounded-[18px] border-[1.5px] border-dashed border-[var(--line)] p-3.5">
      <div>
        <p className="text-sm font-bold">Variants {variants.length === 0 && <span className="font-medium text-[var(--text-muted)]">(optional)</span>}</p>
        <p className="text-xs text-[var(--text-muted)]">
          {food
            ? 'Sell one dish in sizes like Half and Full, or as choices like flavours, each at its own price.'
            : 'Sell one item in sizes, like 500 g and 1 kg, each at its own price.'}
        </p>
      </div>

      {variants.length > 0 && (
        <div className="grid gap-2">
          <span className="text-xs font-bold">What are they?</span>
          <div className="flex flex-wrap gap-2">
            {VARIANT_NAMES[food ? 'food' : 'items'].map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={variantName.trim().toLowerCase() === name.toLowerCase()}
                onClick={() => onVariantName(name)}
                className={cn(
                  'h-10 rounded-full px-4 text-xs font-bold ring-1 transition-colors',
                  variantName.trim().toLowerCase() === name.toLowerCase()
                    ? 'bg-leaf-600 text-white ring-leaf-600'
                    : 'bg-[var(--surface)] text-[var(--leaf-ink)] ring-[var(--line)] hover:bg-[var(--leaf-soft)]'
                )}
              >
                {name}
              </button>
            ))}
          </div>
          <input
            className={fieldClass}
            value={variantName}
            maxLength={20}
            aria-label="What the variants are called"
            placeholder="Or type your own, like Base"
            onChange={(event) => onVariantName(event.target.value)}
          />
          <p className="text-xs text-[var(--text-muted)]">
            Customers see &ldquo;Choose your {noun}&rdquo;.
          </p>
        </div>
      )}

      {variants.length > 0 && (
        <ul className="grid gap-2">
          {variants.map((variant, index) => (
            <li key={variant.id ?? `new-${index}`} className="grid grid-cols-[1fr_6.5rem_2.75rem] items-center gap-2">
              <input
                className={fieldClass}
                value={variant.label}
                maxLength={40}
                placeholder={isSize ? (food ? 'Half' : '500 g') : 'Cheese Onion & Capsicum'}
                aria-label={`${noun} ${index + 1} name`}
                onChange={(event) => update(index, { label: event.target.value })}
              />
              <span className="relative">
                <span aria-hidden className="absolute top-1/2 left-3 -translate-y-1/2 text-sm font-bold text-[var(--text-muted)]">
                  ₹
                </span>
                <input
                  className={cn(fieldClass, 'pl-7')}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  value={variant.price}
                  aria-label={`${noun} ${index + 1} price`}
                  onChange={(event) => update(index, { price: event.target.value })}
                />
              </span>
              <button
                type="button"
                aria-label={`Remove ${variant.label || `${noun} ${index + 1}`}`}
                onClick={() => onChange(variants.filter((_, at) => at !== index))}
                className="grid size-11 place-items-center rounded-full text-xl text-[var(--text-muted)] transition-colors hover:bg-danger/10 hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {variants.length === 0 &&
          SIZE_PRESETS[food ? 'food' : 'items'].map((set) => (
            <button
              key={set.join('/')}
              type="button"
              onClick={() => {
                onChange(set.map((label) => ({ label, price: '' })));
                onVariantName('Size');
              }}
              className="h-10 rounded-full bg-[var(--leaf-soft)] px-4 text-xs font-bold text-[var(--leaf-ink)] ring-1 ring-[var(--line)]"
            >
              {set.join(' / ')}
            </button>
          ))}
        {variants.length < 8 && (
          <button
            type="button"
            onClick={() => onChange([...variants, { label: '', price: '' }])}
            className="h-10 rounded-full px-4 text-xs font-bold text-[var(--leaf-ink)] ring-1 ring-[var(--line)] hover:bg-[var(--leaf-soft)]"
          >
            {variants.length === 0 ? '+ Add your own' : `+ Add ${noun}`}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * What a combo includes, one line each: how many and what. Products are picked from the shop's menu with a
 * tap (a second tap adds one more), or typed for anything else. The menu shows it as "Pizza Mania + Coke".
 */
function ComboEditor({
  items,
  onChange,
  menu
}: {
  items: ComboDraft[];
  onChange: (next: ComboDraft[]) => void;
  menu: Array<{ id: string; name: string }>;
}) {
  const [search, setSearch] = useState('');
  const update = (index: number, change: Partial<ComboDraft>) =>
    onChange(items.map((item, at) => (at === index ? { ...item, ...change } : item)));
  const preview = comboSummary(
    items.filter((item) => item.name.trim()).map((item) => ({ name: item.name.trim(), qty: Number(item.qty) || 1 }))
  );
  const rowOf = (name: string) => items.findIndex((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase());
  const shown = menu.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));

  function pick(name: string) {
    const at = rowOf(name);
    if (at >= 0) return update(at, { qty: String(Math.min(20, (Number(items[at]!.qty) || 0) + 1)) });
    const blank = items.findIndex((item) => !item.name.trim());
    if (blank >= 0) return update(blank, { name, qty: items[blank]!.qty || '1' });
    if (items.length < 12) onChange([...items, { name, qty: '1' }]);
  }

  return (
    <div className="grid gap-3 rounded-[18px] border-[1.5px] border-dashed border-[var(--line)] p-3.5">
      <div>
        <p className="text-sm font-bold">What&rsquo;s in it</p>
        <p className="text-xs text-[var(--text-muted)]">
          {menu.length > 0 ? 'Tap products from your menu, or type any item. ' : 'How many and what. '}
          The combo has one price, set below. To let customers pick, like which pizza, add variants.
        </p>
      </div>

      {menu.length > 0 && (
        <div className="grid gap-2">
          <p className="text-xs font-bold">From your menu</p>
          {menu.length > 12 && (
            <input
              className={fieldClass}
              value={search}
              placeholder="Search your products"
              aria-label="Search your products"
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          <div className="flex max-h-52 flex-wrap gap-2 overflow-y-auto">
            {shown.map((item) => {
              const at = rowOf(item.name);
              const count = at >= 0 ? Number(items[at]!.qty) || 1 : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => pick(item.name)}
                  className={cn(
                    'h-10 rounded-full px-4 text-xs font-bold ring-1 transition-colors active:scale-[0.97]',
                    count
                      ? 'bg-leaf-600 text-white ring-leaf-600'
                      : 'bg-[var(--surface)] text-[var(--leaf-ink)] ring-[var(--line)] hover:bg-[var(--leaf-soft)]'
                  )}
                >
                  {count ? `${count} × ${item.name}` : `+ ${item.name}`}
                </button>
              );
            })}
            {shown.length === 0 && <p className="text-xs text-[var(--text-muted)]">No product matches.</p>}
          </div>
          <p className="text-xs text-[var(--text-muted)]">Tap again to add one more. Change or remove them below.</p>
        </div>
      )}

      <ul className="grid gap-2">
        {items.map((item, index) => (
          // Rows are plain controlled inputs, so their position is a stable enough key.
          <li key={index} className="grid grid-cols-[4.5rem_1fr_2.75rem] items-center gap-2">
            <input
              className={fieldClass}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              step={1}
              value={item.qty}
              aria-label={`Item ${index + 1}: how many`}
              onChange={(event) => update(index, { qty: event.target.value })}
            />
            <input
              className={fieldClass}
              value={item.name}
              maxLength={60}
              placeholder={index === 0 ? 'Pizza Mania' : index === 1 ? 'Coke' : 'Garlic bread'}
              aria-label={`Item ${index + 1}: what`}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <button
              type="button"
              aria-label={`Remove ${item.name || `item ${index + 1}`}`}
              onClick={() => onChange(items.filter((_, at) => at !== index))}
              className="grid size-11 place-items-center rounded-full text-xl text-[var(--text-muted)] transition-colors hover:bg-danger/10 hover:text-danger"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {items.length < 12 && (
        <button
          type="button"
          onClick={() => onChange([...items, { name: '', qty: '1' }])}
          className="h-10 justify-self-start rounded-full px-4 text-xs font-bold text-[var(--leaf-ink)] ring-1 ring-[var(--line)] hover:bg-[var(--leaf-soft)]"
        >
          {menu.length > 0 ? '+ Type an item' : '+ Add an item'}
        </button>
      )}
      {preview && (
        <p className="text-xs text-[var(--text-muted)]">
          Customers see: <span className="font-bold text-[var(--text)]">{preview}</span>
        </p>
      )}
    </div>
  );
}
