import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Log in' };

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-[26px]" />}>
      <AuthForm mode="sign-in" />
    </Suspense>
  );
}
