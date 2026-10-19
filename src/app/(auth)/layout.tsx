import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { Dish } from '@/components/art/dish-photo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="paper relative isolate min-h-dvh overflow-hidden">
      {/* Leaf-green band behind the top of the card, the same chrome colour
          the landing page uses for structure. */}
      <div
        aria-hidden
        className="grain absolute inset-x-0 top-0 -z-10 h-[320px] rounded-b-[44px] bg-linear-160 from-leaf-500 via-leaf-600 to-leaf-800"
      />

      {/* Two dishes drifting behind the band, as on the hero. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] overflow-hidden rounded-b-[44px]">
        <span className="animate-sway absolute -top-6 -left-10 hidden size-44 overflow-hidden rounded-full opacity-45 ring-4 ring-white/15 sm:block sm:size-56">
          <Dish name="dosa" sizes="(max-width: 640px) 16px, 224px" />
        </span>
        <span className="animate-float absolute -top-10 -right-12 hidden size-48 overflow-hidden rounded-full opacity-45 ring-4 ring-white/15 sm:block sm:size-60">
          <Dish name="chai" sizes="(max-width: 640px) 16px, 240px" />
        </span>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col px-5 pt-8 pb-14 sm:px-6">
        <Link href="/" className="animate-rise self-center">
          <Wordmark
            className="text-white"
            markClassName="bg-white/95 bg-none text-leaf-700 shadow-[0_10px_24px_rgb(15_44_29/0.3),inset_0_1px_0_#fff]"
          />
        </Link>

        <div className="animate-rise mt-10 rounded-[34px] bg-[var(--surface)] p-6 shadow-xl ring-1 ring-[var(--line)] [animation-delay:60ms] sm:p-8">
          {children}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-[var(--text-muted)]">
          By continuing you agree to our{' '}
          <Link href="/legal/terms" className="font-semibold text-[var(--leaf-ink)] hover:underline">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/legal/privacy" className="font-semibold text-[var(--leaf-ink)] hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
