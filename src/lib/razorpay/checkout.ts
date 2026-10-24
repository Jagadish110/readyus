import { createClient } from '@/lib/supabase/client';
import { API_URL } from '@/lib/api/client';

/**
 * Browser side of Razorpay Checkout: loads the script once and opens the
 * payment modal. The Razorpay order is created by the payments service, so
 * nothing here can change the amount.
 */

type CheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type CheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: 'INR';
  name: string;
  description: string;
  theme: { color: string };
  image?: string;
  handler: (response: CheckoutResponse) => void;
  modal: { ondismiss: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => { open: () => void };
  }
}

let loading: Promise<boolean> | null = null;

function loadScript() {
  if (window.Razorpay) return Promise.resolve(true);
  loading ??= new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
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

/** Pays one Localty order. Resolves once the server has recorded the payment. */
export async function payForOrder(orderId: string, shopName: string): Promise<PayResult> {
  const start = await callPaymentsApi('/v1/payments/orders', { orderId });
  if (!start) return { ok: false, error: 'Could not reach the payment service. Check your connection and sign in.' };

  const started = (await start.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    keyId?: string;
    razorpayOrderId?: string;
    amount?: number;
    orderCode?: string;
  };
  if (!start.ok || !started.keyId || !started.razorpayOrderId || !started.amount) {
    return {
      ok: false,
      error: started.error ?? 'Could not start the payment.',
      shopNotReady: started.code === 'SHOP_NOT_PAYOUT_READY'
    };
  }

  if (!(await loadScript()) || !window.Razorpay) {
    return { ok: false, error: 'Could not load the payment window. Check your connection.' };
  }

  const Razorpay = window.Razorpay;
  const { keyId, razorpayOrderId, amount, orderCode } = started;

  return new Promise<PayResult>((resolve) => {
    const checkout = new Razorpay({
      key: keyId,
      order_id: razorpayOrderId,
      amount,
      currency: 'INR',
      name: 'Localty',
      image: `${window.location.origin}/brand/localty-icon-192.png`,
      description: `${shopName} · ${orderCode ?? 'order'}`,
      theme: { color: '#1f7a4d' },
      handler: async (response) => {
        const verified = await callPaymentsApi('/v1/payments/verify', response);
        if (verified?.ok) resolve({ ok: true });
        else {
          // The webhook still records a real payment, so this is rarely permanent.
          resolve({
            ok: false,
            error: 'Payment received but not confirmed yet. Refresh in a moment; do not pay again.'
          });
        }
      },
      modal: { ondismiss: () => resolve({ ok: false, error: '', cancelled: true }) }
    });
    // A failed attempt stays inside the modal, where the customer can retry or
    // pick another method; closing it resolves above.
    checkout.open();
  });
}
