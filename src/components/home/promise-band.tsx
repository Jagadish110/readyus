import { Reveal } from '@/components/motion/reveal';

/**
 * The one claim the whole product rests on, set in the deep green band the
 * rest of the page is built around.
 */
export function PromiseBand() {
  return (
    <section className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
      <Reveal className="relative isolate overflow-hidden rounded-[30px] bg-leaf-700 text-white shadow-[0_20px_60px_rgb(23_64_42/0.28)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 50% 70% at 88% 10%, rgb(79 158 112 / 0.55) 0%, transparent 60%), radial-gradient(ellipse 40% 60% at 4% 100%, rgb(246 196 69 / 0.22) 0%, transparent 62%)'
          }}
        />
        <div className="relative grid gap-5 p-7 sm:p-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-12">
          <h2 className="max-w-[16ch] font-display text-[clamp(1.6rem,3.1vw,2.3rem)] leading-[1.06] font-extrabold tracking-[-0.04em]">
            What makes a Localty order different
          </h2>
          <p className="text-[1.02rem] leading-relaxed text-white/85">
            We take no cut of what you order, so the price on the listing is the price you pay — no
            delivery charge, no platform fee, no quietly inflated menu. Every shop you see is
            verified, open right now, and close enough to actually reach your door while the food is
            still hot.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
