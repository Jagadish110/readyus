'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Wordmark } from '@/components/brand/logo';

/** Anything that throws while rendering. Keeps the customer out of a blank screen. */
export default function ErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="paper grid min-h-dvh place-items-center px-5">
      <div className="grid max-w-md justify-items-center gap-5 text-center">
        <Link href="/" aria-label="Localty home">
          <Wordmark />
        </Link>
        <p className="text-eyebrow uppercase text-[var(--leaf-ink)]">Something went wrong</p>
        <h1 className="font-display text-[clamp(1.7rem,4vw,2.3rem)] leading-[1.05] font-extrabold tracking-[-0.045em]">
          We hit a snag on our side
        </h1>
        <p className="max-w-[40ch] text-[var(--text-muted)]">
          Your cart is safe. Try again, and if it keeps happening, come back in a few minutes.
        </p>
        {error.digest && (
          <p className="text-xs text-[var(--text-muted)]">Reference: {error.digest}</p>
        )}
        <div className="grid w-full gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-12 items-center justify-center rounded-full bg-leaf-600 px-6 text-[0.95rem] font-bold text-white shadow-[0_10px_26px_rgb(36_101_64/0.3)] transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-leaf-700 active:scale-95"
          >
            Try again
          </button>
          <Link
            href="/browse"
            className="inline-flex h-12 items-center justify-center rounded-full border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-6 text-[0.95rem] font-bold transition-[transform,border-color] hover:-translate-y-0.5 hover:border-leaf-400"
          >
            Go to browse
          </Link>
        </div>
      </div>
    </main>
  );
}
