import type { Metadata } from 'next';
import { NotFoundView } from '@/components/shell/not-found-view';

export const metadata: Metadata = { title: 'Page not found' };

/** A product or shop that no longer exists, shown inside the header and nav. */
export default function ShopNotFound() {
  return <NotFoundView />;
}
