'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type CartLine = {
  productId: string;
  sellerId: string;
  sellerName: string;
  name: string;
  unit: string;
  price: number;
  mrp: number | null;
  vegType: string;
  image?: string | null;
  /** The chosen size or portion (Half, Full, 500 g); absent for products sold one way. */
  variantId?: string;
  variantLabel?: string;
  /** Extras added, priced for the chosen size; `price` already includes them. place_order charges its own. */
  extras?: Array<{ id: string; label: string; price: number }>;
  quantity: number;
};

/**
 * One cart line per product, size and set of extras: Half and Full are separate lines, and so is the same
 * pizza with and without extra cheese. A line without extras keeps the key it always had.
 */
export const lineKey = (line: { productId: string; variantId?: string; extras?: Array<{ id: string }> }) => {
  const base = line.variantId ? `${line.productId}:${line.variantId}` : line.productId;
  const ids = (line.extras ?? []).map((extra) => extra.id).sort();
  return ids.length ? `${base}+${ids.join('+')}` : base;
};

const STORAGE_KEY = 'readyus-cart';

type CartState = {
  lines: CartLine[];
  ready: boolean;
  count: number;
  subtotal: number;
  /** Lines grouped by shop, because each shop becomes its own order. */
  groups: Array<{ sellerId: string; sellerName: string; lines: CartLine[]; subtotal: number }>;
  /**
   * With extra ids: exactly that size and set of extras. With only a variant id: that size without extras.
   * With neither: the product across all its lines.
   */
  quantityOf: (productId: string, variantId?: string, extraIds?: string[]) => number;
  add: (line: Omit<CartLine, 'quantity'>, quantity?: number) => void;
  /** `key` is lineKey(line); for a product with no sizes that is just its id. 0 removes the line. */
  setQuantity: (key: string, quantity: number) => void;
  removeSeller: (sellerId: string) => void;
  clear: () => void;
};

const Ctx = createContext<CartState | null>(null);

function save(lines: CartLine[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Non-fatal: the cart simply will not survive a reload.
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLines(JSON.parse(raw) as CartLine[]);
    } catch {
      // Ignore unreadable storage; the cart simply starts empty.
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: CartLine[]) => {
    setLines(next);
    save(next);
  }, []);

  const add = useCallback((line: Omit<CartLine, 'quantity'>, quantity = 1) => {
    setLines((current) => {
      const key = lineKey(line);
      const existing = current.find((item) => lineKey(item) === key);
      const next = existing
        ? current.map((item) => (lineKey(item) === key ? { ...item, quantity: item.quantity + quantity } : item))
        : [...current, { ...line, quantity }];
      save(next);
      return next;
    });
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) => {
      const next =
        quantity <= 0
          ? current.filter((item) => lineKey(item) !== key)
          : current.map((item) => (lineKey(item) === key ? { ...item, quantity } : item));
      save(next);
      return next;
    });
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, { sellerId: string; sellerName: string; lines: CartLine[]; subtotal: number }>();
    for (const line of lines) {
      const group = map.get(line.sellerId) ?? {
        sellerId: line.sellerId,
        sellerName: line.sellerName,
        lines: [],
        subtotal: 0
      };
      group.lines.push(line);
      group.subtotal += line.price * line.quantity;
      map.set(line.sellerId, group);
    }
    return [...map.values()];
  }, [lines]);

  const value = useMemo<CartState>(
    () => ({
      lines,
      ready,
      count: lines.reduce((total, line) => total + line.quantity, 0),
      subtotal: lines.reduce((total, line) => total + line.price * line.quantity, 0),
      groups,
      quantityOf: (productId, variantId, extraIds) => {
        if (variantId === undefined && extraIds === undefined) {
          return lines.filter((line) => line.productId === productId).reduce((total, line) => total + line.quantity, 0);
        }
        const key = lineKey({ productId, variantId, extras: (extraIds ?? []).map((id) => ({ id })) });
        return lines.find((line) => lineKey(line) === key)?.quantity ?? 0;
      },
      add,
      setQuantity,
      removeSeller: (sellerId) => persist(lines.filter((line) => line.sellerId !== sellerId)),
      clear: () => persist([])
    }),
    [lines, ready, groups, add, setQuantity, persist]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
