import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Delivery partner log in' };

/**
 * The delivery partners' own door. It is public (the proxy lets it through) so a rider can sign in
 * or sign up here and land on their dashboard, instead of the customer login.
 */
export default async function DeliveryLoginPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user) redirect('/delivery');

  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-[26px]" />}>
      <AuthForm mode={mode === 'sign-up' ? 'sign-up' : 'sign-in'} audience="rider" />
    </Suspense>
  );
}
