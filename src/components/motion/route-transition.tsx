'use client';

import { ViewTransition } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Which animation each kind of navigation gets. Links set the kind with `transitionTypes`:
 * 'nav-forward' for going deeper (a shop, a dish, an order), 'nav-back' for coming back up,
 * 'nav-tab' for a bottom-bar tab. Anything else (the browser's back button, a refresh, a
 * redirect) swaps the page instantly. The animations themselves live in globals.css.
 */
const BY_TYPE = {
  'nav-forward': 'nav-forward',
  'nav-back': 'nav-back',
  'nav-tab': 'nav-fade',
  default: 'none'
};

/** A filter or category on the same page ('nav-filter') is the same place with new content: a crossfade. */
const ON_UPDATE = { 'nav-filter': 'nav-fade', default: 'none' };

/**
 * Wraps the pages of an app shell (in its layout) so each change of page can animate.
 * Keying by the path makes the old page exit and the new one enter, while a change of
 * only the query string (a filter, a category) updates in place and can crossfade.
 *
 * Pages under this must not show a Suspense fallback during navigation: a fallback in the
 * incoming page makes the browser abandon the transition ("aborted because of invalid state").
 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter={BY_TYPE} exit={BY_TYPE} update={ON_UPDATE} default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
