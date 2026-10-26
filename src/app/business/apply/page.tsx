import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { serverApi } from '@/lib/api/server';
import { Eyebrow } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { Wordmark } from '@/components/brand/logo';
import { ApplyForm } from '@/components/business/apply-form';

export const metadata: Metadata = { title: 'List your shop' };

type SellerRow = { shop_name: string; status: 'pending' | 'approved' | 'rejected'; review_note: string };

const STATUS_COPY: Record<SellerRow['status'], { title: string; body: string }> = {
  pending: {
    title: 'Your application is in review',
    body: 'We check every shop before it goes live. You will get a notification as soon as it is approved.'
  },
  approved: {
    title: 'Your shop is live',
    body: 'Customers within your delivery radius can find you now.'
  },
  rejected: {
    title: 'Your application was declined',
    body: 'You can read the note below and apply again with the details corrected.'
  }
};

export default async function ApplyPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/business/apply');

  const result = await serverApi<{ application: SellerRow | null }>('/v1/seller/application');
  // Never show a blank application form when the real problem is the server.
  if (!result.ok) throw new Error('We could not load your application right now. Please try again.');
  const existing = result.data.application;
  const canReapply = !existing || existing.status === 'rejected';

  return (
    <main className="paper grid min-h-dvh place-items-center px-4 py-8">
      <div className="grid w-full max-w-md gap-5">
        <Link href="/" aria-label="Localty home" className="justify-self-center">
          <Wordmark />
        </Link>

        <section className="animate-rise rounded-[30px] bg-[var(--surface)] p-6 shadow-xl ring-1 ring-[var(--line)] sm:p-7">
          <Eyebrow>Sell on Localty</Eyebrow>
          <h1 className="mt-2 font-display text-[1.7rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
            List your shop
          </h1>
          <p className="mt-1.5 mb-5 text-sm text-[var(--text-muted)]">
            Zero commission. A free trial, then one flat monthly fee.
          </p>

          {existing && (
            <div className={canReapply ? 'mb-5 border-b border-[var(--line)] pb-5' : ''}>
              <p className="text-xs font-bold tracking-[0.14em] text-[var(--leaf-ink)] uppercase">
                {existing.shop_name}
              </p>
              <h2 className="mt-1.5 font-display text-lg font-extrabold tracking-[-0.03em]">
                {STATUS_COPY[existing.status].title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
                {STATUS_COPY[existing.status].body}
              </p>
              {existing.review_note && (
                <p className="mt-3 rounded-[18px] bg-[var(--leaf-soft)] px-4 py-3 text-sm ring-1 ring-[var(--line)]">
                  {existing.review_note}
                </p>
              )}
              {!canReapply && (
                <ButtonLink href="/browse" variant="leaf-outline" fullWidth className="mt-5">
                  Back to browsing
                </ButtonLink>
              )}
            </div>
          )}

          {canReapply && <ApplyForm />}
        </section>
      </div>
    </main>
  );
}
