'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { NOT_CONFIGURED } from '@/lib/supabase/config';
import { Button, ButtonLink } from '@/components/ui/button';
import { cn, safeNext } from '@/lib/utils';
import { Field } from './field';

// Where to go once the new password is saved, kept on this device while the email is on its way. The link may
// open on another device, where it is not set; the reset page then goes to browsing.
const AFTER_RESET = 'localty-after-reset';

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <p className="text-eyebrow uppercase text-[var(--leaf-ink)]">Localty account</p>
      <h1 className="mt-2 font-display text-[1.9rem] leading-tight font-extrabold tracking-[-0.04em]">{title}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{children}</p>
    </>
  );
}

function Message({ tone, children }: { tone: 'error' | 'ok'; children: React.ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'mt-5 rounded-[18px] px-4 py-3 text-sm font-medium text-[var(--text)] ring-1',
        tone === 'error' ? 'animate-pop bg-danger/12 ring-danger/35' : 'bg-success/12 ring-success/35'
      )}
    >
      {children}
    </p>
  );
}

/** Step 1: ask for the email and send a link to choose a new password. */
export function ForgotPasswordForm() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'), '/browse');
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  async function send() {
    setError('');
    if (!supabase) return setError(NOT_CONFIGURED);
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError('Enter the email you use to log in.');

    try {
      localStorage.setItem(AFTER_RESET, next);
    } catch {
      // Private browsing: after the reset the page goes to browsing instead.
    }
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      // Where Supabase's own email returns to. The Localty email opens /auth/confirm, which works on any device.
      redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`
    });
    if (error?.status === 429) return setError('Please wait a minute before asking for another link.');
    if (error && (!error.status || error.status >= 500)) {
      return setError('We could not send the email just now. Please try again in a few minutes.');
    }
    // Every other answer reads the same, so this page never tells anyone which emails have an account.
    setSentTo(address);
  }

  if (sentTo) {
    return (
      <div>
        <Heading title="Check your email">
          If an account uses <strong className="text-[var(--text)]">{sentTo}</strong>, we have sent it a link to choose a new
          password. The link works once.
        </Heading>
        <Message tone="ok">Nothing there after a minute? Look in spam or promotions, then ask again.</Message>
        <ButtonLink href="/sign-in" variant="leaf" size="lg" fullWidth className="mt-6">
          Back to log in
        </ButtonLink>
        <p className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setSentTo('')}
            className="inline-flex h-11 items-center text-sm font-semibold text-[var(--leaf-ink)] hover:underline"
          >
            Use a different email
          </button>
        </p>
      </div>
    );
  }

  return (
    <div>
      <Heading title="Forgot your password?">Enter the email you log in with and we will send you a link to choose a new one.</Heading>
      {error && <Message tone="error">{error}</Message>}
      <form
        noValidate
        className="mt-5 grid gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            await send();
          });
        }}
      >
        <Field label="Email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={setEmail} />
        <Button type="submit" size="lg" variant="leaf" fullWidth loading={pending}>
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-[var(--text-muted)]">
        Remembered it?{' '}
        <Link href="/sign-in" className="inline-flex h-11 items-center font-bold text-[var(--leaf-ink)] hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

/** Step 2, opened from the email: the link has signed the person in, so they only choose the new password. */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<'checking' | 'yes' | 'no'>(supabase ? 'checking' : 'no');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!supabase) return;
    let current = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (current) setSession(data.session ? 'yes' : 'no');
    });
    return () => {
      current = false;
    };
  }, [supabase]);

  async function save() {
    setError('');
    if (!supabase) return setError(NOT_CONFIGURED);
    if (password.length < 8) return setError('Use at least 8 characters.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return setError(error.code === 'same_password' ? 'That is your current password. Choose a different one.' : error.message);
    }
    setSaved(true);
  }

  function carryOn() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(AFTER_RESET);
      localStorage.removeItem(AFTER_RESET);
    } catch {
      // Private browsing: go to browsing.
    }
    router.replace(safeNext(params.get('next') ?? stored, '/browse'));
    router.refresh();
  }

  if (session === 'checking') return <div className="skeleton h-80 rounded-[26px]" />;

  if (session === 'no') {
    return (
      <div>
        <Heading title="This link has expired">
          Reset links work once and only for a short while. Ask for a new one and open the newest email.
        </Heading>
        <ButtonLink href="/forgot-password" variant="leaf" size="lg" fullWidth className="mt-6">
          Send a new link
        </ButtonLink>
        <p className="mt-3 text-center">
          <Link href="/sign-in" className="inline-flex h-11 items-center text-sm font-semibold text-[var(--leaf-ink)] hover:underline">
            Back to log in
          </Link>
        </p>
      </div>
    );
  }

  if (saved) {
    return (
      <div>
        <Heading title="Password updated">You are logged in. Use your new password the next time you log in.</Heading>
        <Button size="lg" variant="leaf" fullWidth className="mt-6" onClick={carryOn}>
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Heading title="Choose a new password">Pick one you have not used here before. At least 8 characters.</Heading>
      {error && <Message tone="error">{error}</Message>}
      <form
        noValidate
        className="mt-5 grid gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            await save();
          });
        }}
      >
        <Field
          label="New password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={setPassword}
        />
        <button
          type="button"
          aria-pressed={show}
          onClick={() => setShow((value) => !value)}
          className="-my-1.5 inline-flex h-11 items-center justify-self-end text-sm font-semibold text-[var(--leaf-ink)] hover:underline"
        >
          {show ? 'Hide password' : 'Show password'}
        </button>
        <Button type="submit" size="lg" variant="leaf" fullWidth loading={pending}>
          Save new password
        </Button>
      </form>
    </div>
  );
}
