import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

/** Shared frame for the plain-language policy pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="paper min-h-dvh">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]/90">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" aria-label="Localty home">
            <Wordmark size={36} />
          </Link>
          <nav aria-label="Policies" className="flex gap-4 text-sm font-bold text-[var(--text-muted)]">
            <Link href="/legal/terms" className="hover:text-[var(--leaf-ink)]">Terms</Link>
            <Link href="/legal/privacy" className="hover:text-[var(--leaf-ink)]">Privacy</Link>
            <Link href="/legal/refunds" className="hover:text-[var(--leaf-ink)]">Refunds</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="text-eyebrow uppercase text-[var(--leaf-ink)]">Localty</p>
        <h1 className="mt-2 font-display text-[clamp(1.9rem,4vw,2.5rem)] leading-tight font-extrabold tracking-[-0.04em]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">Last updated {updated}</p>
        <p className="mt-4 rounded-[18px] bg-[var(--tile)] px-4 py-3 text-sm leading-relaxed">
          This page explains in plain words how Localty works today. The formal legal text is being finalised, and this page will be replaced by it.
        </p>
        <div className="legal mt-8 grid gap-6 text-[0.97rem] leading-relaxed [&_h2]:mt-2 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:tracking-[-0.03em] [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1.5">
          {children}
        </div>
        {SUPPORT_EMAIL && (
          <p className="mt-10 border-t border-[var(--line)] pt-4 text-sm">
            Questions? Write to <a className="font-bold text-[var(--leaf-ink)] underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        )}
      </main>
    </div>
  );
}
