import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/utils';

const TYPES: readonly EmailOtpType[] = ['email', 'signup', 'magiclink', 'invite', 'recovery', 'email_change'];

/**
 * The page to open after the link. The email templates pass `next={{ .RedirectTo }}`: the full address the
 * sign-up form asked for (…/auth/callback?next=/checkout), so the page named inside it is the one meant.
 */
function landing(raw: string | null, origin: string) {
  if (!raw) return '/browse';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return '/browse';
    if (url.pathname === '/auth/callback' || url.pathname === '/auth/confirm') {
      return safeNext(url.searchParams.get('next'), '/browse');
    }
    return safeNext(url.pathname + url.search, '/browse');
  } catch {
    return '/browse';
  }
}

/**
 * Opens a link from a Localty email (confirm sign-up, sign-in link, invite, new email address). The one-time
 * token is checked here on the server, so the link works in any browser and on any device, unlike
 * /auth/callback, which needs the browser that started the sign-up.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${landing(searchParams.get('next'), origin)}`);
  }

  // Some mail services open links to scan them, which uses the token before the person taps it. The address
  // is confirmed by then, so logging in with the password works.
  return NextResponse.redirect(`${origin}/sign-in?error=link_used`);
}
