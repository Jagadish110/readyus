import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { BillingBanner } from '@/components/business/billing-banner';
import { BusinessNav } from '@/components/business/business-nav';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="paper flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6">
          <Link href="/business" aria-label="Seller dashboard">
            <Wordmark size={36} />
          </Link>
          <Link
            href="/"
            className="text-sm font-bold text-[var(--text-muted)] hover:text-[var(--leaf-ink)] sm:order-last"
          >
            View shop site
          </Link>
          {/* On a phone the tabs take a row of their own and scroll sideways if they ever outgrow it. */}
          <div className="no-scrollbar -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0">
            <BusinessNav />
          </div>
        </div>
      </header>
      <BillingBanner />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
