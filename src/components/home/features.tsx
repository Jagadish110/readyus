import Link from 'next/link';
import { Reveal } from '@/components/motion/reveal';
import { Dish, type DishKey } from '@/components/art/dish-photo';

const CHECKS = [
  'FSSAI licence and shop address verified before going live',
  'Live radius check — nothing is listed that cannot reach you',
  'Kitchen hours honoured, so a closed shop never takes an order',
  'Every price shown is the shop price, with no commission added',
  'Cash on delivery wherever the shop supports it'
];

const COLLAGE: Array<{ art: DishKey; span: string }> = [
  { art: 'idli', span: 'col-span-2 row-span-2' },
  { art: 'chai', span: '' },
  { art: 'sweet', span: '' },
  { art: 'veg', span: '' },
  { art: 'kirana', span: '' }
];

export function Features() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 lg:px-10">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <Reveal as="h2" className="max-w-[14ch] font-display text-[clamp(1.7rem,3.4vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.045em]">
            Key checks behind every shop you see
          </Reveal>

          <ul className="mt-7 grid gap-3.5">
            {CHECKS.map((check, index) => (
              <Reveal as="li" key={check} delay={index * 70} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-leaf-100 text-leaf-700">
                  <svg viewBox="0 0 20 20" className="size-3.5" aria-hidden>
                    <path
                      d="M4 10.5l4 4 8-9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="text-[0.98rem] leading-relaxed">{check}</span>
              </Reveal>
            ))}
          </ul>

          <Reveal delay={360}>
            <Link
              href="/browse"
              className="mt-8 inline-flex h-13 items-center rounded-full bg-leaf-600 px-7 font-bold text-white shadow-[0_10px_26px_rgb(36_101_64/0.3)] transition-[transform,box-shadow,background-color] hover:-translate-y-0.5 hover:bg-leaf-700 hover:shadow-[0_16px_34px_rgb(36_101_64/0.36)] active:scale-[0.97]"
            >
              Read more
            </Link>
          </Reveal>
        </div>

        <Reveal delay={120} className="grid aspect-[3/2] grid-cols-3 grid-rows-2 gap-3.5">
          {COLLAGE.map((cell, index) => (
            <div
              key={cell.art}
              className={
                'tile relative overflow-hidden rounded-[22px] ring-1 ring-[var(--line)] transition-shadow duration-300 hover:shadow-[0_16px_40px_rgb(28_22_20/0.12)] ' +
                cell.span
              }
            >
              <Dish
                name={cell.art}
                className="tile-art"
                sizes={index === 0 ? '(max-width: 1024px) 60vw, 30vw' : '(max-width: 1024px) 30vw, 15vw'}
              />
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
