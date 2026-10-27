import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Refunds and cancellations' };

export default function RefundsPage() {
  return (
    <LegalPage title="Refunds and cancellations" updated="27 October 2026">
      <section>
        <h2>You pay in cash</h2>
        <p>Nothing was paid in advance, so there is nothing to refund. If the order is cancelled, you simply do not pay.</p>
      </section>

      <section>
        <h2>You paid online: refunded automatically</h2>
        <p>Your payment is refunded to the account you paid from, without you asking, when:</p>
        <ul>
          <li>the shop declines your order, or does not answer it in time;</li>
          <li>you cancel before the shop starts preparing it, or the payment arrived after the order had already been closed;</li>
          <li>the shop cancels after accepting (for example an item ran out);</li>
          <li>the order cannot be delivered because of a problem with the shop or the delivery partner.</li>
        </ul>
        <p>
          You get a &ldquo;Refund started&rdquo; notice when it begins. After that the time it takes to show in your account depends on your bank or card.
        </p>
      </section>

      <section>
        <h2>You paid online: not refunded automatically</h2>
        <p>
          If the order could not be delivered because you could not be reached, refused it, or the address was wrong, the food was already made and taken out,
          so the payment is not refunded automatically. If you think this is wrong, open the order and choose <strong>Report a problem</strong>. Our team will look at it and can still decide to refund you.
        </p>
      </section>

      <section>
        <h2>Something was wrong with a delivered order</h2>
        <p>
          A missing item, the wrong item or poor quality: open the order and choose <strong>Report a problem</strong>. The shop and our team are told. The shop can refund
          all or part of what you paid online, and will mark the problem as resolved with a note you can read on the order page.
        </p>
      </section>

      <section>
        <h2>Cancelling</h2>
        <ul>
          <li>You can cancel on your own until the shop starts preparing the order. The order page shows a Cancel button while you can.</li>
          <li>After that, only the shop can cancel. Contact the shop with the Call button on the order page.</li>
        </ul>
      </section>
    </LegalPage>
  );
}
