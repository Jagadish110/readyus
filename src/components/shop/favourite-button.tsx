'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

/** A heart on the shop page. Signed-out visitors are sent to log in, then back here. */
export function FavouriteButton({ shopId, className }: { shopId: string; className?: string }) {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return setSignedIn(false);
    supabase.auth.getUser().then(async ({ data }) => {
      setSignedIn(Boolean(data.user));
      if (!data.user) return;
      const list = await api<{ shops: Array<{ id: string }> }>('GET', '/v1/favourites');
      if (list.ok) setOn(list.data.shops.some((shop) => shop.id === shopId));
    });
  }, [shopId]);

  async function toggle() {
    if (signedIn === false) return router.push(`/sign-in?next=/shop/${shopId}`);
    if (busy) return;
    setBusy(true);
    const next = !on;
    setOn(next);
    const result = await api('POST', `/v1/favourites/shops/${shopId}`, { on: next });
    if (!result.ok) setOn(!next);
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Remove from favourites' : 'Save this shop to favourites'}
      className={cn(
        'grid size-11 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] shadow-xs transition-transform active:scale-90',
        on ? 'text-brand-500' : 'text-[var(--text-muted)] hover:text-brand-500',
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.4 5 6.4 5c1.9 0 3.4 1 4.4 2.5h.4C12.2 6 13.7 5 15.6 5c3 0 4.8 2.8 3.6 6.2-1.7 4.7-7.2 9.3-7.2 9.3Z" />
      </svg>
    </button>
  );
}
