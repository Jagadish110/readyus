import type { Metadata } from 'next';
import { NotFoundView } from '@/components/shell/not-found-view';

export const metadata: Metadata = { title: 'Page not found' };

/** Unmatched URLs. These render outside the shop layout, so the logo comes along. */
export default function NotFound() {
  return (
    <main className="paper min-h-dvh px-5">
      <NotFoundView withLogo />
    </main>
  );
}
