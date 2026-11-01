import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Admin log in', robots: { index: false } };

/** Staff log in here with an email and password; the admin role itself is checked on every admin page. */
export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="skeleton h-80 rounded-[26px]" />}>
      <AuthForm mode="sign-in" audience="admin" />
    </Suspense>
  );
}
