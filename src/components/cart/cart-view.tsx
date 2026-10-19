'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCart } from '@/lib/state/cart';
import { ButtonLink } from '@/components/ui/button';
import { VegMark } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/card';
import { Dish } from '@/components/art/dish-photo';
import { dishForProduct } from '@/components/art/dish-map';
import { MinusIcon, PlusIcon } from '@/components/shell/icons';
import { formatRupees } from '@/lib/utils';

export function CartView() {
  const { groups, ready, subtotal, count, setQuantity, removeSeller } = useCart();

  if (!ready) {
    return (
      <div className="grid gap-4">
        <div className="skeleton h-10 w-40 rounded-full" />
        <div className="skeleton h-48 rounded-[26px]" />
      </div>
    );
  }

  if (!groups.length) {
    return (
      <div className="animate-rise mx-auto mt-8 max-w-md rounded-[30px] bg-[var(--surface)] p-9 text-center shadow-sm ring-1 ring-[var(--line)]">
        <span
          aria-hidden
          className="relative mx-auto block size-28 overflow-hidden rounded-full bg-[var(--tile)]"
        >
          <Dish name="veg" sizes="112px" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-extrabold tracking-[-0.035em]">
          Your cart is empty
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
          Add something from a shop near you and it will show up here.
        </p>
        <ButtonLink href="/browse" variant="leaf" size="lg" className="mt-6">
          Start browsing
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="grid gap-5">
        <div className="animate-rise">
          <Eyebrow>Your basket</Eyebrow>
          <h1 className="mt-2 font-display text-[clamp(1.6rem,3.5vw,2.1rem)] font-extrabold tracking-[-0.04em]">
            Your cart
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {count} {count === 1 ? 'item' : 'items'} from {groups.length}{' '}
            {groups.length === 1 ? 'shop' : 'shops'}
          </p>
        </div>

        {/* Each shop becomes its own order, so the cart says so up front. */}
        {groups.map((group, index) => (
          <section
            key={group.sellerId}
            className="animate-rise grid gap-3"
            style={{ animationDelay: index * 70 + 'ms' }}
          >
            <header className="flex items-end justify-between gap-3">
              <Link href={'/shop/' + group.sellerId} className="min-w-0">
                <span className="block text-[0.64rem] font-bold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">
                  Order {index + 1} of {groups.length}
                </span>
                <h2 className="truncate font-display text-lg font-extrabold tracking-[-0.03em]">
                  {group.sellerName}
                </h2>
              </Link>
              <button
                type="button"
                onClick={() => removeSeller(group.sellerId)}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-[var(--text-muted)] transition-colors hover:bg-danger/12 hover:text-danger"
              >
                Remove all
              </button>
            </header>

            <ul className="grid gap-3 sm:grid-cols-2">
              {group.lines.map((line) => (
                <li
                  key={line.productId}
                  className="flex gap-3.5 rounded-[22px] bg-[var(--surface)] p-3 shadow-sm ring-1 ring-[var(--line)]"
                >
                  <span
                    aria-hidden
                    className="relative block size-[84px] shrink-0 overflow-hidden rounded-[16px] bg-[var(--tile)]"
                  >
                    {line.image ? (
                      <Image src={line.image} alt="" fill sizes="84px" className="object-cover" />
                    ) : (
                      <Dish name={dishForProduct({ id: line.productId, name: line.name })} sizes="84px" />
                    )}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start gap-1.5">
                      <VegMark type={line.vegType} />
                      <p className="line-clamp-2 text-[0.92rem] leading-snug font-bold">{line.name}</p>
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-[var(--text-muted)]">
                      {formatRupees(line.price)}
                      {line.unit ? ' · ' + line.unit : ''}
                    </p>

                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                      <div className="flex items-center gap-0.5 rounded-full bg-[var(--tile)] p-0.5">
                        <button
                          type="button"
                          aria-label={'Remove one ' + line.name}
                          onClick={() => setQuantity(line.productId, line.quantity - 1)}
                          className="grid size-7 place-items-center rounded-full transition-[transform,background-color] hover:bg-[var(--leaf-soft)] hover:text-[var(--leaf-ink)] active:scale-90"
                        >
                          <MinusIcon className="size-3.5" />
                        </button>
                        <span className="min-w-5 text-center text-sm font-extrabold tabular-nums">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={'Add one ' + line.name}
                          onClick={() => setQuantity(line.productId, line.quantity + 1)}
                          className="grid size-7 place-items-center rounded-full transition-[transform,background-color] hover:bg-[var(--leaf-soft)] hover:text-[var(--leaf-ink)] active:scale-90"
                        >
                          <PlusIcon className="size-3.5" />
                        </button>
                      </div>

                      <p className="font-display font-extrabold tabular-nums text-brand-600">
                        {formatRupees(line.price * line.quantity)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {group.lines.length > 1 && (
              <p className="flex items-center justify-between px-1 text-sm">
                <span className="font-semibold text-[var(--text-muted)]">Shop subtotal</span>
                <span className="font-display font-extrabold tabular-nums">{formatRupees(group.subtotal)}</span>
              </p>
            )}
          </section>
        ))}
      </div>

      <aside className="animate-rise sticky top-24 grid gap-4 rounded-[26px] bg-[var(--surface)] p-6 shadow-sm ring-1 ring-[var(--line)] [animation-delay:80ms]">
        <h2 className="font-display text-lg font-extrabold tracking-[-0.03em]">Order summary</h2>

        <dl className="grid gap-2.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--text-muted)]">Items ({count})</dt>
            <dd className="font-bold tabular-nums">{formatRupees(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--text-muted)]">Delivery</dt>
            <dd className="text-[var(--text-muted)]">Calculated at checkout</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--text-muted)]">Commission</dt>
            <dd className="font-bold text-[var(--leaf-ink)]">Zero, always</dd>
          </div>
        </dl>

        <div className="flex items-baseline justify-between border-t border-[var(--line)] pt-3">
          <span className="font-bold">Subtotal</span>
          <span className="font-display text-xl font-extrabold tabular-nums text-brand-600">
            {formatRupees(subtotal)}
          </span>
        </div>

        {groups.length > 1 && (
          <p className="rounded-[18px] bg-[var(--leaf-soft)] px-4 py-3 text-xs leading-relaxed font-medium text-[var(--leaf-ink)] ring-1 ring-[var(--line)]">
            Items from {groups.length} shops become {groups.length} separate orders, each
            accepted and delivered on its own.
          </p>
        )}

        <ButtonLink href="/checkout" size="lg" fullWidth>
          Proceed to checkout
        </ButtonLink>
      </aside>
    </div>
  );
}
