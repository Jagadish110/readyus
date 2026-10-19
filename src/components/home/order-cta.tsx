import Link from 'next/link';
import { Reveal } from '@/components/motion/reveal';
import { GuestOnly } from '@/components/auth/guest-only';
import { Dish } from '@/components/art/dish-photo';

const STEPS = [
  { title: 'Drop your pin', body: 'Share your location once and choose a radius: 1, 3, 5 or 10 km.' },
  { title: 'See what reaches you', body: 'Only shops that can deliver to your door are listed.' },
  { title: 'Order and track', body: 'The shop packs it, a partner carries it, you watch it move.' }
];

export function OrderCta() {
  return (
    <section className="mx-auto max-w-7xl px-5 pb-16 sm:px-8 lg:px-10">
      <Reveal className="relative isolate overflow-hidden rounded-[30px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_18px_50px_rgb(28_22_20/0.09)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 46% 70% at 96% 20%, rgb(255 176 32 / 0.2) 0%, transparent 62%), radial-gradient(ellipse 40% 60% at 2% 90%, rgb(47 127 82 / 0.14) 0%, transparent 64%)'
          }}
        />

        <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[1fr_0.8fr] lg:items-center">
          <div>
            <h2 className="max-w-[18ch] font-display text-[clamp(1.7rem,3.4vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.045em]">
              Hungry now? It is three steps from here.
            </h2>

            <ol className="mt-7 grid gap-5 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <span className="grid size-9 place-items-center rounded-full bg-leaf-100 font-display font-extrabold text-leaf-700">
                    {index + 1}
                  </span>
                  <strong className="mt-3 block text-[0.98rem] font-extrabold">{step.title}</strong>
                  <span className="mt-1 block text-sm leading-relaxed text-[var(--text-muted)]">
                    {step.body}
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-8 flex flex-wrap gap-3">
              <GuestOnly>
                <Link
                  href="/sign-up"
                  className="inline-flex h-13 items-center rounded-full bg-brand-500 px-7 font-bold text-white shadow-ember transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_16px_38px_rgb(255_77_28/0.42)] active:scale-[0.97]"
                >
                  Create your account
                </Link>
              </GuestOnly>
              <Link
                href="/browse"
                className="inline-flex h-13 items-center rounded-full border-[1.5px] border-[var(--line)] px-7 font-bold transition-[transform,border-color,color] hover:-translate-y-0.5 hover:border-leaf-500 hover:text-[var(--leaf-ink)]"
              >
                Continue as guest
              </Link>
            </div>
          </div>

          <div className="animate-float relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-[28px] shadow-[0_24px_44px_rgb(28_22_20/0.2)] ring-1 ring-[var(--line)]">
            <Dish name="sweet" sizes="(max-width: 1024px) 70vw, 280px" />
          </div>
        </div>
      </Reveal>
    </section>
  );
}
