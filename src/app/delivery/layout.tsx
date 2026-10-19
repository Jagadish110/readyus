import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="paper flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/delivery" aria-label="Delivery home" className="flex items-center gap-2.5">
            <Wordmark markClassName="size-9 rounded-[12px] text-base" />
            <Badge tone="leaf-soft">Delivery</Badge>
          </Link>
          <Link href="/" className="text-sm font-bold text-[var(--text-muted)] hover:text-[var(--leaf-ink)]">
            Shop site
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-6 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
