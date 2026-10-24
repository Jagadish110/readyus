import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { BusinessNav } from '@/components/business/business-nav';

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="paper flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/business" aria-label="Seller dashboard">
            <Wordmark size={36} wordClassName="hidden sm:flex" />
          </Link>
          <BusinessNav />
          <Link
            href="/"
            className="hidden text-sm font-bold text-[var(--text-muted)] hover:text-[var(--leaf-ink)] sm:block"
          >
            View shop site
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
