import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/orders/db';
import { serverApi } from '@/lib/api/server';
import type { OrderView } from '@/lib/orders/load';
import { getFssaiNumber } from '@/lib/data/marketplace';
import { PrintButton } from '@/components/orders/print-button';
import { STATUS_LABEL } from '@/lib/orders/status';
import { formatPaise } from '@/lib/utils';

export const metadata: Metadata = { title: 'Order receipt' };
export const dynamic = 'force-dynamic';

const PAYMENT = {
  normal_cod: 'Cash on delivery',
  full_prepaid: 'Paid online',
  cod_partial_prepayment: 'Part online, rest in cash'
} as const;

/**
 * A plain record of what was ordered and paid. It is an order receipt, not a GST tax invoice: the shop
 * issues its own bill for tax purposes.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=/orders/${id}/receipt`);

  const result = await serverApi<OrderView>(`/v1/orders/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    throw new Error('We could not load this receipt right now. Please try again.');
  }
  const { order, items } = result.data;
  const fssai = order.seller ? await getFssaiNumber(order.seller.id) : null;
  const address = order.delivery_address;
  const when = new Date(order.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <article className="mx-auto grid max-w-xl gap-5 rounded-[26px] bg-[var(--surface)] p-6 shadow-sm ring-1 ring-[var(--line)] print:rounded-none print:shadow-none print:ring-0">
      <header className="grid gap-1 border-b border-[var(--line)] pb-4">
        <p className="text-xs font-extrabold tracking-[0.16em] text-[var(--leaf-ink)] uppercase">Order receipt</p>
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.035em]">{order.seller?.shop_name ?? 'Shop'}</h1>
        {order.seller?.address && <p className="text-sm text-[var(--text-muted)]">{order.seller.address}</p>}
        {order.seller?.phone && <p className="text-sm text-[var(--text-muted)]">Phone {order.seller.phone}</p>}
        {fssai && <p className="text-sm text-[var(--text-muted)]">FSSAI Lic. No. <span className="tabular-nums">{fssai}</span></p>}
      </header>

      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        <div><dt className="inline text-[var(--text-muted)]">Order </dt><dd className="inline font-bold">{order.order_code}</dd></div>
        <div><dt className="inline text-[var(--text-muted)]">Placed </dt><dd className="inline font-bold">{when}</dd></div>
        <div><dt className="inline text-[var(--text-muted)]">Payment </dt><dd className="inline font-bold">{PAYMENT[order.payment_mode]}</dd></div>
        <div><dt className="inline text-[var(--text-muted)]">Status </dt><dd className="inline font-bold">{STATUS_LABEL[order.status]}</dd></div>
      </dl>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-xs tracking-[0.1em] text-[var(--text-muted)] uppercase">
            <th className="pb-2 font-bold">Item</th>
            <th className="pb-2 text-right font-bold">Qty</th>
            <th className="pb-2 text-right font-bold">Price</th>
            <th className="pb-2 text-right font-bold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-[var(--line)] last:border-b-0">
              <td className="py-2 pr-2">{item.name}{item.variant_label && <span className="text-[var(--text-muted)]"> ({item.variant_label})</span>}</td>
              <td className="py-2 text-right tabular-nums">{item.quantity}</td>
              <td className="py-2 text-right tabular-nums">{formatPaise(item.unit_price_paise)}</td>
              <td className="py-2 text-right font-semibold tabular-nums">{formatPaise(item.line_total_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="grid gap-1.5 border-t border-[var(--line)] pt-3 text-sm">
        <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Items</dt><dd className="font-semibold tabular-nums">{formatPaise(order.subtotal_paise)}</dd></div>
        <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Delivery and fees</dt><dd className="font-semibold tabular-nums">{order.delivery_fee_paise + order.platform_fee_paise > 0 ? formatPaise(order.delivery_fee_paise + order.platform_fee_paise) : 'Free'}</dd></div>
        <div className="flex justify-between border-t border-[var(--line)] pt-2 text-base"><dt className="font-bold">Total</dt><dd className="font-display font-extrabold tabular-nums">{formatPaise(order.total_paise)}</dd></div>
        {order.verified_prepaid_paise > 0 && <div className="flex justify-between"><dt className="text-[var(--text-muted)]">Paid online</dt><dd className="font-semibold tabular-nums">{formatPaise(order.verified_prepaid_paise)}</dd></div>}
      </dl>

      <p className="text-sm text-[var(--text-muted)]">
        Delivered to {address.recipient || 'you'}, {[address.line1, address.line2, address.city, address.pincode].filter(Boolean).join(', ')}.
      </p>
      <p className="text-xs text-[var(--text-muted)]">This is a record of your order, not a GST tax invoice. Ask the shop if you need one.</p>

      <div className="flex flex-wrap gap-3 print:hidden">
        <PrintButton />
        <Link href={`/orders/${id}`} className="inline-flex h-11 items-center rounded-full border-[1.5px] border-[var(--line)] px-6 text-sm font-bold">Back to the order</Link>
      </div>
    </article>
  );
}
