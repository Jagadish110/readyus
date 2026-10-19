import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-[15px] font-display text-lg font-extrabold',
        'bg-linear-140 from-brand-400 to-brand-600 text-white',
        'shadow-[0_10px_24px_rgb(255_77_28/0.32),inset_0_1px_0_rgb(255_255_255/0.4)]',
        className
      )}
    >
      R
    </span>
  );
}

export function Wordmark({
  className,
  markClassName
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className={markClassName} />
      <span className="font-display text-xl font-extrabold tracking-[-0.035em]">ReadyUs</span>
    </span>
  );
}

/** Concentric radius rings with a shopping bag — the product idea in one mark. */
export function RadiusArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 360 340"
      role="img"
      aria-label="A shopping bag inside nearby delivery radius rings"
      className={className}
    >
      <circle cx="180" cy="176" r="150" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="2" />
      <circle cx="180" cy="176" r="112" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="2" strokeDasharray="8 12" />
      <circle cx="180" cy="176" r="74" fill="currentColor" fillOpacity=".12" />
      <path
        d="M180 26c-40 0-72 31-72 71 0 53 72 116 72 116s72-63 72-116c0-40-32-71-72-71Z"
        fill="currentColor"
        fillOpacity=".96"
      />
      <circle cx="180" cy="95" r="30" fill="#ff4d1c" />
      <path d="M140 210h80l12 92c1.4 13-8.8 24-22 24h-60c-13.2 0-23.4-11-22-24l12-92Z" fill="currentColor" fillOpacity=".9" />
      <path d="M158 222v-14c0-15 10-27 22-27s22 12 22 27v14" fill="none" stroke="#ff4d1c" strokeWidth="9" strokeLinecap="round" />
      <path d="M154 262h52" stroke="#ffb020" strokeWidth="12" strokeLinecap="round" />
    </svg>
  );
}
