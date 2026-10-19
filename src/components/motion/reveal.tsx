'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type RevealProps = {
  /** Which element to render. Defaults to a div. */
  as?: React.ElementType;
  /** Stagger, in milliseconds, applied once the element enters view. */
  delay?: number;
  className?: string;
  children: React.ReactNode;
};

/**
 * Fades and lifts its children the first time they scroll into view.
 *
 * The work is done by `.reveal` / `.is-in` in globals.css, so the only job
 * here is to flip the class once. Elements already in view on load get the
 * class immediately, which keeps the hero from flashing empty.
 */
export function Reveal({ as: Tag = 'div', delay = 0, className, children }: RevealProps) {
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Without IntersectionObserver, show everything rather than nothing.
    if (typeof IntersectionObserver === 'undefined') {
      node.classList.add('is-in');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={cn('reveal', className)}
      style={delay ? ({ '--reveal-delay': delay + 'ms' } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}
