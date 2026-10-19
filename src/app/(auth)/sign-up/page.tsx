import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Create your account' };

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-[26px]" />}>
      <AuthForm mode="sign-up" />
    </Suspense>
  );
}
