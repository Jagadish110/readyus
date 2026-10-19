import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * `primary` is the vermillion order action and stays reserved for it. Anything
 * structural or navigational — continue, change, confirm a choice — uses the
 * leaf variants, which match the landing page's green chrome.
 */
type Variant =
  | 'primary'
  | 'leaf'
  | 'leaf-outline'
  | 'leaf-soft'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'soft';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'border-0 bg-linear-135 from-brand-400 via-brand-500 to-brand-600 text-white shadow-[0_8px_26px_rgb(255_77_28/0.32)] ' +
    'inset-shadow-[0_1px_0_rgb(255_255_255/0.4)] hover:-translate-y-0.5 ' +
    'hover:shadow-[0_14px_34px_rgb(255_77_28/0.42)]',
  leaf:
    'border-0 bg-leaf-600 text-white shadow-[0_10px_26px_rgb(36_101_64/0.3)] ' +
    'inset-shadow-[0_1px_0_rgb(255_255_255/0.22)] hover:-translate-y-0.5 hover:bg-leaf-700 ' +
    'hover:shadow-[0_16px_34px_rgb(36_101_64/0.36)]',
  'leaf-outline':
    'border-[1.5px] border-leaf-300 bg-[var(--surface)] text-[var(--leaf-ink)] shadow-sm ' +
    'hover:-translate-y-0.5 hover:border-leaf-600 hover:bg-[var(--leaf-soft)] hover:shadow-md',
  'leaf-soft': 'border-0 bg-[var(--leaf-soft)] text-[var(--leaf-ink)] hover:bg-[var(--leaf-soft)]0/15',
  outline:
    'border-[1.5px] border-[var(--line)] bg-[var(--surface)] text-[var(--text)] shadow-sm ' +
    'hover:-translate-y-0.5 hover:border-brand-500 hover:bg-brand-500/10 hover:text-brand-600 hover:shadow-md',
  ghost: 'border-0 bg-transparent text-[var(--text-muted)] hover:bg-brand-500/10 hover:text-brand-600',
  soft: 'border-0 bg-brand-500/10 text-brand-600 hover:bg-brand-500/20',
  danger: 'border-0 bg-danger text-white hover:brightness-110 shadow-sm'
};

const SIZES: Record<Size, string> = {
  sm: 'h-10 px-4 text-sm gap-1.5',
  md: 'h-12 px-6 text-[0.95rem] gap-2',
  lg: 'h-14 px-8 text-base gap-2.5'
};

type BaseProps = {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
  className?: string;
  children?: React.ReactNode;
};

function classes({ variant = 'primary', size = 'md', fullWidth, className }: BaseProps) {
  return cn(
    'relative inline-flex items-center justify-center rounded-full font-bold tracking-[-0.01em]',
    'transition-[transform,box-shadow,background-color,color] duration-150 ease-[var(--ease-spring)]',
    'active:scale-[0.965] disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
    className
  );
}

export function Button({
  variant,
  size,
  fullWidth,
  loading,
  className,
  children,
  disabled,
  ...props
}: BaseProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={classes({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  fullWidth,
  className,
  children,
  href,
  ...props
}: BaseProps & React.ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={classes({ variant, size, fullWidth, className })} {...props}>
      {children}
    </Link>
  );
}
