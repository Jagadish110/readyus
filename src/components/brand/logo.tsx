import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The Localty brand: the symbol and the lowercase "localty" word are separate
 * images so a narrow header can show the symbol alone. `light` is the white
 * version for dark or coloured backgrounds.
 */
type Tone = 'brand' | 'light';

const FILES: Record<Tone, { mark: string; word: string }> = {
  brand: { mark: '/brand/localty-mark.png', word: '/brand/localty-word.png' },
  light: { mark: '/brand/localty-mark-white.png', word: '/brand/localty-word-white.png' }
};

export function LogoMark({ className, size, tone = 'brand' }: { className?: string; size?: number; tone?: Tone }) {
  return (
    <Image
      src={FILES[tone].mark}
      alt=""
      aria-hidden
      width={226}
      height={231}
      priority
      // An explicit pixel size when given; otherwise the caller's classes decide.
      style={size ? { width: size, height: size } : undefined}
      className={cn('shrink-0 object-contain', !size && (className ?? 'size-11'), size && className)}
    />
  );
}

/** The word is 75.7% of the symbol's height in the original logo, sitting on the same baseline. */
const WORD_RATIO = 0.757;

export function Wordmark({
  className,
  size = 44,
  wordClassName,
  tone = 'brand'
}: {
  className?: string;
  /** Height of the symbol in pixels; the word scales with it. */
  size?: number;
  /** Extra classes for the word, e.g. "hidden sm:flex" to show only the symbol on phones. */
  wordClassName?: string;
  tone?: Tone;
}) {
  return (
    <span role="img" aria-label="Localty" className={cn('inline-flex items-end gap-2.5', className)}>
      <LogoMark tone={tone} size={size} />
      <span className={cn('flex', wordClassName)}>
        <Image
          src={FILES[tone].word}
          alt=""
          aria-hidden
          width={407}
          height={175}
          priority
          style={{ height: Math.round(size * WORD_RATIO), width: 'auto' }}
        />
      </span>
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
