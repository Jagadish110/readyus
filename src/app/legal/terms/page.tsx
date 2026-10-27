import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Terms of use' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="27 October 2026">
      <section>
        <h2>What Localty is</h2>
        <p>
          Localty is a marketplace that lets people order from shops and kitchens near them. The shops set their own prices and
          decide what they sell. Localty does not cook, pack or stock anything. Localty does not take a commission on orders, and
          customers pay no platform fee.
        </p>
      </section>

      <section>
        <h2>For customers</h2>
        <ul>
          <li>You can browse without an account. You need one to place an order.</li>
          <li>Give a correct address and phone number. The delivery partner needs them to reach you.</li>
          <li>The price you see is the shop&rsquo;s price. You pay the order total shown at checkout.</li>
          <li>Every order is paid online when you place it.</li>
          <li>You get a 6-digit code on your order page. Tell it to the delivery partner only when you have received your order.</li>
          <li>You can cancel on the order page until the shop starts preparing it; a Cancel button shows while you can. After that, ask the shop, or report a problem on the order page.</li>
          <li>Do not misuse the service: no false orders, no abuse of shops or delivery partners, no attempts to get around payments.</li>
        </ul>
      </section>

      <section>
        <h2>For shops</h2>
        <ul>
          <li>Shops pay Localty a flat monthly fee after a free trial. There is no commission and no fee per order.</li>
          <li>You are responsible for what you sell: its quality, price, ingredients, labelling and safety, and for having the licences the law requires. Food shops must hold a valid FSSAI licence or registration. We check the document before approving a shop and show the number to customers. A shop whose licence expires is hidden until it is renewed.</li>
          <li>Online payments go from the customer to your bank account through our payment partner. Localty does not hold your sales money.</li>
          <li>If you cannot make an order you accepted, cancel it with a reason. Online payments for cancelled orders are refunded to the customer.</li>
          <li>A shop whose subscription is unpaid is hidden after a short grace period and takes no new orders. Orders already placed can still be completed.</li>
          <li>Localty may hide or suspend a shop that breaks these terms or the law.</li>
        </ul>
      </section>

      <section>
        <h2>For delivery partners</h2>
        <ul>
          <li>You deliver for the shops whose team you joined. The shop assigns each order to you.</li>
          <li>Hand an order over only to the person who gives you the correct 6-digit code. You never collect money; every order is already paid online.</li>
          <li>Your location is shared with the customer only while you are delivering an order.</li>
        </ul>
      </section>

      <section>
        <h2>Payments and refunds</h2>
        <p>See the <a className="font-bold text-[var(--leaf-ink)] underline" href="/legal/refunds">refunds page</a>.</p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>We may change how Localty works or these terms. Important changes will be shown in the app before they take effect.</p>
      </section>
    </LegalPage>
  );
}
