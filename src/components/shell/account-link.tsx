'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { UserIcon } from './icons';

type Who = { label: string; avatar: string | null } | null;

/**
 * The header's answer to "am I signed in?": the person's initial when they
 * are, a log-in link when they are not. It reads the browser session and
 * follows sign-in and sign-out without a page reload.
 */
export function AccountLink() {
  const [who, setWho] = useState<Who>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setReady(true);
      return;
    }

    const read = (user: { email?: string; user_metadata?: Record<string, unknown> } | null | undefined) => {
      if (!user) return setWho(null);
      const meta = user.user_metadata ?? {};
      const name = String(meta.full_name ?? meta.name ?? '').trim();
      setWho({
        label: (name || user.email || 'U')[0]!.toUpperCase(),
        avatar: typeof meta.avatar_url === 'string' ? meta.avatar_url : null
      });
    };

    supabase.auth.getUser().then(({ data }) => {
      read(data.user);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => read(session?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Hold the slot while the session loads so the header does not jump.
  if (!ready) return <span aria-hidden className="size-10 shrink-0" />;

  if (!who) {
    return (
      <Link
        href="/sign-in"
        aria-label="Log in"
        className="grid size-10 shrink-0 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)] shadow-xs transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)]"
      >
        <UserIcon className="size-[19px]" />
      </Link>
    );
  }

  return (
    <Link
      href="/account"
      aria-label="Your account"
      className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-leaf-600 text-sm font-extrabold text-white shadow-[0_6px_16px_rgb(36_101_64/0.3)] transition-transform hover:-translate-y-0.5"
    >
      {who.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={who.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        who.label
      )}
    </Link>
  );
}
