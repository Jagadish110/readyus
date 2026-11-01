import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { visitorHeaders } from '@/lib/api/visitor';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** Route prefixes that require a signed-in user, and the role each one needs. */
const GUARDED: Array<{ prefix: string; role: string }> = [
  { prefix: '/business', role: 'seller' },
  { prefix: '/delivery', role: 'delivery' },
  { prefix: '/admin', role: 'admin' }
];

/** Customer routes that need a session but no special role. */
// Guests may browse and build a cart; an account is needed only to order.
const CUSTOMER_ONLY = ['/checkout', '/orders', '/account', '/favourites'];

/** Pages under a guarded prefix that must stay open to someone who is not signed in. */
const PUBLIC = ['/delivery/login', '/admin/login'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        }
      }
    }
  );

  // Refreshes the session cookie, then checks the login's signature here against the project's public
  // signing key (fetched once and cached), so a page view does not wait on a call to Supabase. Must run
  // before any auth check. The backend still asks Supabase itself before it trusts a login with data.
  const { data: auth } = await supabase.auth.getClaims();
  const signedIn = Boolean(auth?.claims?.sub);

  const path = request.nextUrl.pathname;
  if (PUBLIC.includes(path)) return response;

  const guarded = GUARDED.find((entry) => path.startsWith(entry.prefix));
  const needsCustomer = CUSTOMER_ONLY.some((prefix) => path.startsWith(prefix));

  const toSignIn = () => {
    const signIn = request.nextUrl.clone();
    // Delivery partners and staff have their own logins; everyone else uses the customer one.
    signIn.pathname =
      guarded?.prefix === '/delivery' ? '/delivery/login' : guarded?.prefix === '/admin' ? '/admin/login' : '/sign-in';
    signIn.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(signIn);
  };

  if ((guarded || needsCustomer) && !signedIn) return toSignIn();

  // The application page is where someone without the role goes to get it, so
  // it needs a login but cannot also demand the role it hands out.
  const isApplication = guarded ? path === `${guarded.prefix}/apply` : false;

  if (guarded && signedIn && !isApplication) {
    // Roles are read from the database by the backend, never from the token, so
    // a revoked role stops working immediately.
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    let held: string[] | null = null;
    try {
      const response = await fetch(`${API_URL}/v1/me`, {
        headers: { Authorization: `Bearer ${token ?? ''}`, ...visitorHeaders(request.headers) },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000)
      });
      if (response.ok) held = ((await response.json()) as { roles: string[] }).roles;
      // Signed out on another device: the token's signature is still good, but the login is gone.
      else if (response.status === 401) return toSignIn();
    } catch {
      // fall through to the closed-door answer below
    }

    // If the backend cannot say who this is, nobody gets into a restricted area.
    if (held === null) {
      return new NextResponse('The service is temporarily unavailable. Please try again in a moment.', { status: 503 });
    }

    if (!held.includes(guarded.role)) {
      const target = request.nextUrl.clone();
      // Admin is invite-only; the others have a public application flow.
      target.pathname =
        guarded.role === 'admin' ? '/' : `${guarded.prefix}/apply`;
      target.search = '';
      return NextResponse.redirect(target);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets. Keeping images out
     * avoids an auth round trip on every icon request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)'
  ]
};
