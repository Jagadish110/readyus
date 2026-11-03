'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { friendlyError } from '@/lib/orders/errors';
import { lineKey, useCart } from '@/lib/state/cart';
import { useShopTerms } from '@/lib/state/use-shop-terms';
import { createClient } from '@/lib/supabase/client';

export type PayChoice = 'online' | 'cod';

/**
 * Everything the cart and checkout pages share to place an order: who is signed in, which ways to pay
 * every shop in the cart takes, and the request itself. Placing opens the order page, where the
 * customer waits for the shop to accept.
 */
export function useOrdering() {
  const router = useRouter();
  const { groups, setQuantity } = useCart();
  const { terms, loaded: termsLoaded } = useShopTerms(groups.map((group) => group.sellerId));
  const [who, setWho] = useState<{ id: string } | null | undefined>(undefined);
  // Shops whose online payment is ready (UPI ID verified and switched on); null while loading.
  const [onlineShops, setOnlineShops] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<PayChoice | null>(null);
  const [placing, setPlacing] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setWho(null);
      return;
    }
    supabase.auth.getUser().then(({ data }) => setWho(data.user ? { id: data.user.id } : null));
  }, []);

  const shopIds = groups.map((group) => group.sellerId).join(',');
  useEffect(() => {
    if (!who || !shopIds) return;
    api<{ ready: string[] }>('GET', `/v1/shops/online?ids=${shopIds}`).then((result) =>
      setOnlineShops(result.ok ? result.data.ready : [])
    );
  }, [who, shopIds]);

  // A way to pay is offered only when every shop in the cart takes it; one order per shop, one choice.
  const onlineOk = onlineShops !== null && groups.every((group) => onlineShops.includes(group.sellerId));
  const codOk = termsLoaded && groups.every((group) => terms[group.sellerId]?.cod_available);
  const choice: PayChoice | null =
    picked === 'online' && onlineOk ? 'online' : picked === 'cod' && codOk ? 'cod' : onlineOk ? 'online' : codOk ? 'cod' : null;

  async function place(addressId: string, note = '') {
    if (!who || !addressId || !choice) return;

    setPlacing(true);
    setProblems([]);

    // One request; the backend places each shop as its own order, so one shop
    // failing never undoes the others, and it prices everything from the database.
    const result = await api<{ placed: string[]; failed: Array<{ sellerId: string; message: string }> }>(
      'POST',
      '/v1/checkout',
      {
        addressId,
        payOnline: choice === 'online',
        note: note.trim(),
        shops: groups.map((group) => ({
          sellerId: group.sellerId,
          lines: group.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId ?? '',
            // The server prices these itself; it only needs to know which were chosen.
            extraIds: (line.extras ?? []).map((extra) => extra.id),
            quantity: line.quantity
          }))
        }))
      }
    );

    if (!result.ok) {
      setPlacing(false);
      setProblems([friendlyError(result.error)]);
      return;
    }

    const { placed, failed } = result.data;
    const nameOf = (sellerId: string) => groups.find((group) => group.sellerId === sellerId)?.sellerName ?? 'A shop';
    const reasons = failed.map((item) => nameOf(item.sellerId) + ': ' + friendlyError(item.message));

    // Clear only the shops that went through; the rest stay in the cart.
    const placedSellers = new Set(groups.map((group) => group.sellerId));
    for (const item of failed) placedSellers.delete(item.sellerId);
    for (const group of groups) {
      if (placedSellers.has(group.sellerId)) for (const line of group.lines) setQuantity(lineKey(line), 0);
    }

    setProblems(reasons);

    if (placed.length && !failed.length) {
      // The cart is already empty; keep the loading state so an empty-cart screen
      // never flashes before the order page opens.
      setRedirecting(true);
      router.push(placed.length === 1 ? `/orders/${placed[0]}` : '/orders');
    } else {
      setPlacing(false);
      if (placed.length) {
        setProblems([...reasons, `${placed.length} order${placed.length > 1 ? 's were' : ' was'} placed. See Orders.`]);
      }
    }
  }

  return {
    who,
    terms,
    termsLoaded,
    payLoading: onlineShops === null || !termsLoaded,
    onlineOk,
    codOk,
    choice,
    pick: setPicked,
    place,
    placing,
    redirecting,
    problems,
    setProblems
  };
}
