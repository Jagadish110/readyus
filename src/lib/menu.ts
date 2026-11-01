import type { ComboItem, ShopExtra } from '@/lib/database.types';

/** "Pizza Mania + 2 × Coke": what a combo includes, in one line. Empty for a product that is not a combo. */
export function comboSummary(items: ComboItem[] | null | undefined) {
  return (items ?? []).map((item) => (item.qty > 1 ? `${item.qty} × ${item.name}` : item.name)).join(' + ');
}

/** The variants' own name as the shop set it, in lower case: size (the default), flavour, pizza. */
export function variantNoun(variantName: string | null | undefined) {
  return (variantName?.trim() || 'Size').toLowerCase();
}

/** "Choose your size", "Choose your pizza". */
export function choosePrompt(variantName: string | null | undefined) {
  return `Choose your ${variantNoun(variantName)}`;
}

/** "3 sizes" on a menu line; "4 choices" when the variants are not sizes (flavours, pizzas). */
export function variantCount(count: number, variantName: string | null | undefined) {
  return variantNoun(variantName) === 'size' ? `${count} sizes` : `${count} choices`;
}

/**
 * What an extra costs with a dish of this size: its price for a size of the same name (ignoring case and
 * spaces), otherwise its own price. Matches extra_price() in the database, which is what the order charges.
 */
export function extraPrice(extra: ShopExtra, size: string | null | undefined) {
  const wanted = (size ?? '').trim().toLowerCase();
  const match = extra.size_prices?.find((entry) => entry.size.trim().toLowerCase() === wanted);
  return Number(match ? match.price : extra.price);
}

/** "+ Extra cheese, Cheese burst crust": the extras on a cart or order line. Empty when there are none. */
export function extrasSummary(extras: Array<{ label: string }> | null | undefined) {
  return extras?.length ? `+ ${extras.map((extra) => extra.label).join(', ')}` : '';
}
