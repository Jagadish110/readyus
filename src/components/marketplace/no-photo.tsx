import { cn } from '@/lib/utils';

/**
 * What a shop or product without its own photo shows: the first letter of its name on a plain tile.
 * Never a stock picture of food, so a customer is not shown a dish the shop does not make.
 * Fills its container, which must be positioned.
 */
export function NoPhoto({ name, className }: { name: string; className?: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-0 grid place-items-center bg-[var(--leaf-soft)] font-display font-extrabold text-[var(--leaf-ink)] [container-type:size]',
        className
      )}
    >
      {/* Scales with the tile: large on a product page, small in a cart row. */}
      <span className="text-[clamp(1rem,40cqmin,6rem)] leading-none opacity-70">{letter}</span>
    </span>
  );
}
