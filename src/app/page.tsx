import { SiteHeader } from '@/components/home/site-header';
import { Hero } from '@/components/home/hero';
import { Tape } from '@/components/home/tape';
import { PromiseBand } from '@/components/home/promise-band';
import { MenuBoard } from '@/components/home/menu-board';
import { Features } from '@/components/home/features';
import { Shops } from '@/components/home/shops';
import { OrderCta } from '@/components/home/order-cta';
import { SiteFooter } from '@/components/home/site-footer';

export default function LandingPage() {
  return (
    <div className="paper min-h-dvh">
      <SiteHeader />

      <main>
        <Hero />
        <Tape />
        <div className="pt-16">
          <PromiseBand />
        </div>
        <MenuBoard />
        <Features />
        <Shops />
        <OrderCta />
      </main>

      <SiteFooter />
    </div>
  );
}
