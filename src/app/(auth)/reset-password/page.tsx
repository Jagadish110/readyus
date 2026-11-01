import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/password-reset';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-[26px]" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
