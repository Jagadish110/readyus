import Link from 'next/link';
import { Dish } from '@/components/art/dish-photo';
import { Wordmark } from '@/components/brand/logo';

const LINKS = [
  { href: '/browse', label: 'Browse nearby shops' },
  { href: '/search', label: 'Search for a dish' },
  { href: '/cart', label: 'Open my cart' }
];

/**
 * The page a customer lands on when a link is stale: a shop that closed, a
 * dish that was removed, a mistyped address. It says what happened in plain
 * words and gives three ways back into the catalogue, so a dead end is never
 * the last thing they see.
 */
export function NotFoundView({ withLogo = false }: { withLogo?: boolean }) {
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-6 py-10 text-center">
      {withLogo && (
        <Link href="/" aria-label="Localty home">
          <Wordmark />
        </Link>
      )}

      <span
        aria-hidden
        className="animate-rise relative block size-40 overflow-hidden rounded-full bg-[var(--tile)] shadow-[0_22px_50px_rgb(28_22_20/0.14)] ring-1 ring-[var(--line)]"
      >
        <Dish name="chai" sizes="160px" />
      </span>

      <div className="animate-rise [animation-delay:60ms]">
        <p className="text-eyebrow uppercase text-[var(--leaf-ink)]">Error 404</p>
        <h1 className="mt-2 font-display text-[clamp(1.7rem,4vw,2.3rem)] leading-[1.05] font-extrabold tracking-[-0.045em]">
          This page went out for chai
        </h1>
        <p className="mx-auto mt-3 max-w-[40ch] text-[var(--text-muted)]">
          The link may be old, or the shop or dish may no longer be listed. Nothing is wrong with your
          account or your cart.
        </p>
      </div>

      <nav aria-label="Where to next" className="animate-rise grid w-full gap-2.5 [animation-delay:120ms]">
        {LINKS.map((link, index) => (
          <Link
            key={link.href}
            href={link.href}
            className={
              index === 0
                ? 'inline-flex h-12 items-center justify-center rounded-full bg-leaf-600 px-6 text-[0.95rem] font-bold text-white shadow-[0_10px_26px_rgb(36_101_64/0.3)] transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-leaf-700'
                : 'inline-flex h-12 items-center justify-center rounded-full border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-6 text-[0.95rem] font-bold text-[var(--text)] transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)]'
            }
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <Link href="/" className="text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--leaf-ink)]">
        Back to the home page
      </Link>
    </div>
  );
}
