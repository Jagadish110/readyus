import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { BillingBanner } from '@/components/business/billing-banner';
import { ComplianceBanner } from '@/components/business/compliance-banner';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { BusinessNav, BusinessTabBar } from '@/components/business/business-nav';
import { RouteTransition } from '@/components/motion/route-transition';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="paper flex min-h-dvh flex-col">
      <header
        className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur"
        style={{ viewTransitionName: 'app-header' }}
      >
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/business" aria-label="Seller dashboard">
            <Wordmark size={36} />
          </Link>
          {/* Tabs sit here on larger screens; phones get the bottom bar instead. */}
          <div className="hidden lg:block">
            <BusinessNav />
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex h-11 items-center rounded-full px-3 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--leaf-ink)]"
            >
              View shop site
            </Link>
            <NotificationCenter />
          </div>
        </div>
      </header>
      <BillingBanner />
      <ComplianceBanner />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 sm:px-6 lg:pb-16">
        <RouteTransition>{children}</RouteTransition>
      </main>
      <BusinessTabBar />
    </div>
  );
}
