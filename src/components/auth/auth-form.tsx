'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NOT_CONFIGURED =
  'Supabase is not connected yet. Add your project URL and keys to .env.local, then restart the dev server.';

type Method = 'phone' | 'email';
type Mode = 'sign-in' | 'sign-up';

const METHODS: Array<{ id: Method; label: string }> = [
  { id: 'phone', label: 'Mobile OTP' },
  { id: 'email', label: 'Email' }
];

const CALLBACK_ERRORS: Record<string, string> = {
  auth_failed: 'That sign-in link did not work or has expired. Please try again.'
};

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/browse';

  const [method, setMethod] = useState<Method>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState(CALLBACK_ERRORS[params.get('error') ?? ''] ?? '');
  const [notice, setNotice] = useState('');
  const [pending, startTransition] = useTransition();

  const supabase = useMemo(() => createClient(), []);
  const configured = isSupabaseConfigured();
  const isSignUp = mode === 'sign-up';

  function fail(message: string) {
    setError(message);
    setNotice('');
  }

  async function sendOtp() {
    setError('');
    if (!supabase) return fail(NOT_CONFIGURED);
    // Indian numbers are the common case; a typed country code still wins.
    const parsed = parsePhoneNumberFromString(phone, 'IN');
    if (!parsed?.isValid()) return fail('Enter a valid mobile number.');

    const { error } = await supabase.auth.signInWithOtp({
      phone: parsed.number,
      options: { shouldCreateUser: isSignUp }
    });

    if (error) return fail(error.message);
    setOtpSent(true);
    setNotice('We sent a 6-digit code to ' + parsed.formatInternational() + '.');
  }

  async function verifyOtp() {
    setError('');
    if (!supabase) return fail(NOT_CONFIGURED);
    const parsed = parsePhoneNumberFromString(phone, 'IN');
    if (!parsed?.isValid()) return fail('Enter a valid mobile number.');

    const { error } = await supabase.auth.verifyOtp({
      phone: parsed.number,
      token: otp.trim(),
      type: 'sms'
    });

    if (error) return fail(error.message);
    router.replace(next);
    router.refresh();
  }

  async function submitEmail() {
    setError('');
    if (!supabase) return fail(NOT_CONFIGURED);
    if (!email.trim() || password.length < 8) {
      return fail('Enter your email and a password of at least 8 characters.');
    }

    const credentials = { email: email.trim().toLowerCase(), password };
    const { data, error } = isSignUp
      ? await supabase.auth.signUp({
          ...credentials,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: location.origin + '/auth/callback?next=' + encodeURIComponent(next)
          }
        })
      : await supabase.auth.signInWithPassword(credentials);

    if (error) return fail(error.message);

    // With email confirmation off the account is live immediately.
    if (isSignUp && !data.session) {
      setNotice('Check your inbox to confirm your email, then log in.');
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function withGoogle() {
    setError('');
    if (!supabase) return fail(NOT_CONFIGURED);
    const redirectTo = location.origin + '/auth/callback?next=' + encodeURIComponent(next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) fail(error.message);
  }

  function run(action: () => Promise<unknown>) {
    startTransition(() => {
      void action();
    });
  }

  return (
    <div>
      <p className="text-eyebrow uppercase text-[var(--leaf-ink)]">Localty account</p>
      <h1 className="mt-2 font-display text-[1.9rem] leading-tight font-extrabold tracking-[-0.04em]">
        {isSignUp ? 'Create your account' : 'Welcome back'}
      </h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {isSignUp
          ? 'One account works for shopping, selling and delivering.'
          : 'Log in to pick up where you left off.'}
      </p>

      <Button
        size="lg"
        variant="outline"
        fullWidth
        loading={pending}
        onClick={() => run(withGoogle)}
        className="mt-6"
      >
        {!pending && <GoogleMark className="size-5" />}
        {isSignUp ? 'Sign up with Google' : 'Continue with Google'}
      </Button>

      <div className="mt-5 flex items-center gap-3 text-xs font-bold tracking-[0.14em] text-[var(--text-muted)] uppercase">
        <span className="h-px flex-1 bg-[var(--line)]" />
        or with
        <span className="h-px flex-1 bg-[var(--line)]" />
      </div>

      <div className="mt-5 inline-flex w-full gap-1 rounded-full border border-[var(--line)] bg-[var(--tile)] p-1.5 shadow-[inset_0_1px_3px_rgb(28_22_20/0.05)]">
        {METHODS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setMethod(item.id);
              setError('');
              setNotice('');
            }}
            className={cn(
              'h-10 flex-1 rounded-full text-sm font-bold transition-all duration-200',
              method === item.id
                ? 'bg-[var(--surface)] text-[var(--leaf-ink)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!configured && (
        <p className="mt-5 rounded-[18px] bg-warning/12 px-4 py-3 text-sm font-medium text-[var(--text)] ring-1 ring-warning/35">
          Connect a Supabase project to enable sign-in. The screens below are fully built.
        </p>
      )}

      {error && (
        <p className="animate-pop mt-5 rounded-[18px] bg-danger/12 px-4 py-3 text-sm font-medium text-[var(--text)] ring-1 ring-danger/35">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mt-5 rounded-[18px] bg-success/12 px-4 py-3 text-sm font-medium text-[var(--text)] ring-1 ring-success/35">
          {notice}
        </p>
      )}

      <div className="mt-5 grid gap-3.5">
        {method === 'phone' && (
          <>
            <Field
              label="Mobile number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={setPhone}
              disabled={otpSent}
            />
            {otpSent && (
              <Field
                label="6-digit code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter the code"
                value={otp}
                onChange={setOtp}
              />
            )}
            <Button
              size="lg"
              variant="leaf"
              fullWidth
              loading={pending}
              onClick={() => run(otpSent ? verifyOtp : sendOtp)}
            >
              {otpSent ? 'Verify and continue' : 'Send code'}
            </Button>
            {otpSent && (
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtp('');
                  setNotice('');
                }}
                className="text-sm font-semibold text-[var(--leaf-ink)] hover:underline"
              >
                Use a different number
              </button>
            )}
          </>
        )}

        {method === 'email' && (
          <>
            {isSignUp && (
              <Field label="Full name" type="text" autoComplete="name" placeholder="Your name" value={fullName} onChange={setFullName} />
            )}
            <Field label="Email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={setEmail} />
            <Field
              label="Password"
              type="password"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder="At least 8 characters"
              value={password}
              onChange={setPassword}
            />
            <Button size="lg" variant="leaf" fullWidth loading={pending} onClick={() => run(submitEmail)}>
              {isSignUp ? 'Create account' : 'Log in'}
            </Button>
          </>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
        {isSignUp ? 'Already have an account? ' : 'New to Localty? '}
        <Link href={isSignUp ? '/sign-in' : '/sign-up'} className="font-bold text-[var(--leaf-ink)] hover:underline">
          {isSignUp ? 'Log in' : 'Create one'}
        </Link>
      </p>

      <p className="mt-3 text-center">
        <Link href="/browse" className="text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--leaf-ink)]">
          Continue as guest
        </Link>
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  ...props
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[0.82rem] font-bold">{label}</span>
      <input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-14 rounded-[18px] border-[1.5px] border-[var(--line)] bg-[var(--surface)] px-4 text-base outline-none transition-all placeholder:text-ink-400 focus:border-leaf-500 focus:ring-4 focus:ring-leaf-500/20 disabled:opacity-60"
      />
    </label>
  );
}
