import { createClient } from '@/lib/supabase/client';
import { API_URL } from '@/lib/api/client';

/**
 * Browser side of Cashfree Checkout: loads the script once and opens the
 * payment modal. The Cashfree order is created by the payments service, so
 * nothing here can change the amount.
 */

type CheckoutResult = { error?: { message?: string }; paymentDetails?: unknown; redirect?: boolean };

type CashfreeSdk = {
  checkout: (options: { paymentSessionId: string; redirectTarget: '_modal' }) => Promise<CheckoutResult>;
};

declare global {
  interface Window {
    Cashfree?: (options: { mode: 'sandbox' | 'production' }) => CashfreeSdk;
  }
}

let loading: Promise<boolean> | null = null;

function loadScript() {
  if (window.Cashfree) return Promise.resolve(true);
  loading ??= new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
    script.onload = () => resolve(true);
    script.onerror = () => {
      loading = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return loading;
}

/** POSTs JSON to the payments service as the signed-in user. */
export async function callPaymentsApi(path: string, body: unknown): Promise<Response | null> {
  const supabase = createClient();
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) return null;

  try {
    return await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body)
    });
  } catch {
    return null;
  }
}

export type PayResult = { ok: true } | { ok: false; error: string; cancelled?: boolean; shopNotReady?: boolean };

/** Pays one ReadyUs order. Resolves once the server has recorded the payment. */
export async function payForOrder(orderId: string): Promise<PayResult> {
  const start = await callPaymentsApi('/v1/payments/orders', { orderId });
  if (!start) return { ok: false, error: 'Could not reach the payment service. Check your connection and sign in.' };

  const started = (await start.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    mode?: 'sandbox' | 'production';
    paymentSessionId?: string;
  };
  if (!start.ok || !started.paymentSessionId || !started.mode) {
    return {
      ok: false,
      error: started.error ?? 'Could not start the payment.',
      shopNotReady: started.code === 'SHOP_NOT_PAYOUT_READY'
    };
  }

  if (!(await loadScript()) || !window.Cashfree) {
    return { ok: false, error: 'Could not load the payment window. Check your connection.' };
  }

  const cashfree = window.Cashfree({ mode: started.mode });
  // A failed attempt stays inside the modal, where the customer can retry or
  // pick another method; closing it resolves with no payment details.
  const result = await cashfree.checkout({ paymentSessionId: started.paymentSessionId, redirectTarget: '_modal' });

  // The server asks Cashfree directly, so a closed modal or a stale tab is settled correctly.
  const verified = await callPaymentsApi('/v1/payments/verify', { orderId });
  if (verified?.ok) return { ok: true };
  if (result.error && !result.paymentDetails) return { ok: false, error: '', cancelled: true };

  // The webhook still records a real payment, so this is rarely permanent.
  return {
    ok: false,
    error: 'Payment received but not confirmed yet. Refresh in a moment; do not pay again.'
  };
}
