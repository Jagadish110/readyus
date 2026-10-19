'use client';

import { useSignedIn } from '@/lib/state/session';

/** Renders its children only for visitors who are not signed in. */
export function GuestOnly({ children }: { children: React.ReactNode }) {
  return useSignedIn() === false ? <>{children}</> : null;
}
