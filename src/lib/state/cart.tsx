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
  quantity: number;
};

const STORAGE_KEY = 'readyus-cart';

type CartState = {
  lines: CartLine[];
  ready: boolean;
  count: number;
  subtotal: number;
  /** Lines grouped by shop, because each shop becomes its own order. */
  groups: Array<{ sellerId: string; sellerName: string; lines: CartLine[]; subtotal: number }>;
  quantityOf: (productId: string) => number;
  add: (line: Omit<CartLine, 'quantity'>, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  removeSeller: (sellerId: string) => void;
  clear: () => void;
};

const Ctx = createContext<CartState | null>(null);

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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal.
    }
  }, []);

  const add = useCallback(
    (line: Omit<CartLine, 'quantity'>, quantity = 1) => {
      setLines((current) => {
        const existing = current.find((item) => item.productId === line.productId);
        const next = existing
          ? current.map((item) =>
              item.productId === line.productId
                ? { ...item, quantity: item.quantity + quantity }
                : item
            )
          : [...current, { ...line, quantity }];

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Non-fatal.
        }
        return next;
      });
    },
    []
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      setLines((current) => {
        const next =
          quantity <= 0
            ? current.filter((item) => item.productId !== productId)
            : current.map((item) => (item.productId === productId ? { ...item, quantity } : item));

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Non-fatal.
        }
        return next;
      });
    },
    []
  );

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
      quantityOf: (productId) => lines.find((line) => line.productId === productId)?.quantity ?? 0,
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
