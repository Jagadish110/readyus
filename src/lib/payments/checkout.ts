import { createClient } from '@/lib/supabase/client';
import { API_URL } from '@/lib/api/client';

/**
 * Browser side of Cashfree Checkout: loads Cashfree's script once and opens the payment
 * popup. The Cashfree order is created by the backend, so nothing here can change the amount,
 * and whether it was paid is decided by the backend asking Cashfree, never by this page.
 */

type CheckoutResult = {
  error?: { message?: string };
  redirect?: boolean;
  paymentDetails?: unknown;
};

type CashfreeSdk = {
  checkout: (options: { paymentSessionId: string; redirectTarget?: '_modal' | '_self' | '_blank' }) => Promise<CheckoutResult>;
};

declare global {
  interface Window {
    Cashfree?: (config: { mode: 'sandbox' | 'production' }) => CashfreeSdk;
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

/** POSTs JSON to the backend as the signed-in user. */
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

/** Pays one Localty order. Resolves once the backend has confirmed the payment with Cashfree. */
export async function payForOrder(orderId: string): Promise<PayResult> {
  const start = await callPaymentsApi('/v1/payments/orders', { orderId });
  if (!start) return { ok: false, error: 'Could not reach the payment service. Check your connection and sign in.' };

  const started = (await start.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    paymentSessionId?: string;
    mode?: 'sandbox' | 'production';
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

  // Opens the popup; resolves when the customer finishes or closes it.
  let result: CheckoutResult;
  try {
    result = await window.Cashfree({ mode: started.mode }).checkout({
      paymentSessionId: started.paymentSessionId,
      redirectTarget: '_modal'
    });
  } catch {
    return { ok: false, error: 'The payment window could not open. Please try again.' };
  }

  // Whatever the popup said, ask the backend, which asks Cashfree.
  const verified = await callPaymentsApi('/v1/payments/verify', { orderId });
  const outcome = verified ? ((await verified.json().catch(() => ({}))) as { paid?: boolean }) : null;

  if (outcome?.paid) return { ok: true };

  if (result.paymentDetails && !outcome) {
    // Paid at Cashfree but we could not confirm it just now. The webhook records it either way.
    return { ok: false, error: 'Payment received but not confirmed yet. Refresh in a moment; do not pay again.' };
  }
  if (result.error?.message) return { ok: false, error: result.error.message };
  return { ok: false, error: '', cancelled: true };
}
