'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-runs the server page on an interval so a list stays current without a reload. */
export function AutoRefresh({ everyMs = 15_000 }: { everyMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [router, everyMs]);

  return null;
}
