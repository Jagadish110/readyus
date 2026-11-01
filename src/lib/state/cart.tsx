'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';

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
/** Whose cart this browser holds: a user id once it has been saved to that account, absent for a guest's. */
const OWNER_KEY = 'readyus-cart-owner';
/** How often an open, visible tab picks up changes made on another device. */
const PULL_EVERY_MS = 20_000;
/** Edits within this window are saved together. */
const PUSH_AFTER_MS = 400;

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

function readOwner() {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Non-fatal: the next visit merges again, which only re-adds what is already there.
  }
}

/** What the server stores for a line; it fills in names and prices itself. */
const toSaved = (line: CartLine) => ({
  productId: line.productId,
  variantId: line.variantId ?? '',
  extraIds: (line.extras ?? []).map((extra) => extra.id),
  quantity: line.quantity
});

/**
 * A guest's cart joining the account's saved one at sign-in. A line in both keeps the larger quantity,
 * so signing in twice on one device never doubles it.
 */
function merge(saved: CartLine[], guest: CartLine[]) {
  const byKey = new Map(saved.map((line) => [lineKey(line), line]));
  for (const line of guest) {
    const key = lineKey(line);
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, quantity: Math.max(existing.quantity, line.quantity) } : line);
  }
  return [...byKey.values()];
}

/**
 * Keeps the cart on the account while someone is signed in, so every device shows the same one:
 * each edit is saved to the backend, and a visible tab re-reads it on focus and every 20 seconds.
 * A guest's cart stays in this browser and joins the account's at sign-in.
 */
function useAccountCart(lines: CartLine[], replace: (next: CartLine[]) => void, ready: boolean) {
  const userRef = useRef<string | null>(null);
  // Counts local edits; a read that started before the latest edit is stale and dropped.
  const editsRef = useRef(0);
  const pushTimer = useRef<number | undefined>(undefined);
  const pushing = useRef(false);
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  const pull = useCallback(async () => {
    if (!userRef.current || pushing.current || pushTimer.current !== undefined) return;
    const startedAt = editsRef.current;
    const result = await api<{ lines: CartLine[] }>('GET', '/v1/cart');
    if (result.ok && startedAt === editsRef.current && pushTimer.current === undefined) replace(result.data.lines);
  }, [replace]);

  const push = useCallback(async (current?: CartLine[]) => {
    pushTimer.current = undefined;
    if (!userRef.current) return;
    pushing.current = true;
    const startedAt = editsRef.current;
    const result = await api<{ lines: CartLine[] }>('POST', '/v1/cart', {
      lines: (current ?? linesRef.current).map(toSaved)
    });
    pushing.current = false;
    // The server's copy has current names and prices; take it unless more edits arrived meanwhile.
    if (result.ok && startedAt === editsRef.current && pushTimer.current === undefined) replace(result.data.lines);
  }, [replace]);

  /** Called after every local edit. */
  const edited = useCallback(() => {
    editsRef.current += 1;
    if (!userRef.current) return;
    window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => void push(), PUSH_AFTER_MS);
  }, [push]);

  // Signing in, out, or into another account.
  useEffect(() => {
    if (!ready) return;
    const supabase = createClient();
    if (!supabase) return;

    const adopt = async (userId: string | null) => {
      if (userId === userRef.current) return;
      userRef.current = userId;
      if (!userId) {
        // Signed out: the account's cart stays on the account, not on a shared screen.
        if (readOwner()) replace([]);
        writeOwner(null);
        return;
      }
      const startedAt = editsRef.current;
      const result = await api<{ lines: CartLine[] }>('GET', '/v1/cart');
      if (!result.ok || userRef.current !== userId) return;
      const owner = readOwner();
      if (startedAt !== editsRef.current) {
        // Edited while this loaded: those edits are already on their way to the server.
      } else if (owner === userId || linesRef.current.length === 0) {
        // This browser already holds this account's cart (or nothing): the saved copy is the truth.
        replace(result.data.lines);
      } else if (owner === null) {
        // A guest cart: bring it into the account.
        const merged = merge(result.data.lines, linesRef.current);
        replace(merged);
        editsRef.current += 1;
        void push(merged);
      } else {
        // Another account's leftovers: show this account's cart instead.
        replace(result.data.lines);
      }
      writeOwner(userId);
    };

    supabase.auth.getSession().then(({ data }) => void adopt(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => void adopt(session?.user.id ?? null));
    return () => sub.subscription.unsubscribe();
  }, [ready, replace, push]);

  // Picking up changes from other devices.
  useEffect(() => {
    if (!ready) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pull();
    };
    const timer = window.setInterval(onVisible, PULL_EVERY_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready, pull]);

  return edited;
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

  // Replaces the cart with a copy from the server; not an edit, so nothing is sent back.
  const replace = useCallback((next: CartLine[]) => {
    setLines(next);
    save(next);
  }, []);

  const edited = useAccountCart(lines, replace, ready);

  const persist = useCallback(
    (next: CartLine[]) => {
      setLines(next);
      save(next);
      edited();
    },
    [edited]
  );

  const add = useCallback(
    (line: Omit<CartLine, 'quantity'>, quantity = 1) => {
      setLines((current) => {
        const key = lineKey(line);
        const existing = current.find((item) => lineKey(item) === key);
        const next = existing
          ? current.map((item) => (lineKey(item) === key ? { ...item, quantity: item.quantity + quantity } : item))
          : [...current, { ...line, quantity }];
        save(next);
        return next;
      });
      edited();
    },
    [edited]
  );

  const setQuantity = useCallback(
    (key: string, quantity: number) => {
      setLines((current) => {
        const next =
          quantity <= 0
            ? current.filter((item) => lineKey(item) !== key)
            : current.map((item) => (lineKey(item) === key ? { ...item, quantity } : item));
        save(next);
        return next;
      });
      edited();
    },
    [edited]
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
