import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/password-reset';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-[26px]" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
