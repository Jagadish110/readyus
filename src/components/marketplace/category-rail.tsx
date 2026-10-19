'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { NearbyCategory } from '@/lib/database.types';
import { cn } from '@/lib/utils';

export function CategoryRail({
  categories,
  active
}: {
  categories: NearbyCategory[];
  active?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (!categories.length) return null;

  function select(key?: string) {
    const next = new URLSearchParams(params.toString());
    if (key) next.set('category', key);
    else next.delete('category');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="no-scrollbar -mx-4 flex min-w-0 gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <Chip label="All" active={!active} onClick={() => select()} />
      {categories.map((category) => (
        <Chip
          key={category.category_key}
          label={category.name}
          active={active === category.category_key}
          onClick={() => select(category.category_key)}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-5 py-2.5 text-[0.92rem] font-bold whitespace-nowrap',
        'transition-[transform,background-color,border-color,color,box-shadow] duration-200 active:scale-[0.96]',
        active
          ? 'border-leaf-600 bg-leaf-600 text-white'
          : 'border-[var(--line)] bg-[var(--surface)] text-[var(--text-muted)] hover:-translate-y-0.5 hover:border-leaf-400 hover:text-[var(--leaf-ink)]'
      )}
    >
      {label}
    </button>
  );
}
