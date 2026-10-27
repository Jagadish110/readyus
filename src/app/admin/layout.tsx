import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { AdminNav } from '@/components/admin/admin-nav';
import { NotificationCenter } from '@/components/notifications/notification-center';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="paper flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap sm:px-6">
          <Link href="/admin" aria-label="Admin overview">
            <Wordmark size={36} />
          </Link>
          <div className="flex items-center gap-3 sm:order-last">
            <NotificationCenter />
          </div>
          <div className="no-scrollbar -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0">
            <AdminNav />
          </div>
        </div>
      </header>
      <main className="flex-1 pb-16">{children}</main>
    </div>
  );
}
