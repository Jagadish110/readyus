import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="27 October 2026">
      <section>
        <h2>What we collect, and why</h2>
        <ul>
          <li><strong>Your account:</strong> name, email or phone number, to sign you in and contact you about orders.</li>
          <li><strong>Addresses you save:</strong> where to deliver, the contact name and phone for the delivery, and a map pin.</li>
          <li><strong>Your location while browsing:</strong> the place you choose or allow, kept on your device and sent with searches to find shops in range. We do not track you in the background.</li>
          <li><strong>Orders:</strong> what you ordered, from which shop, the amount, how you paid, and the delivery progress.</li>
          <li><strong>Notifications:</strong> if you turn on alerts, your browser&rsquo;s push address, so we can send them. You can turn them off any time.</li>
          <li><strong>Shop owners:</strong> shop details, and for approval an FSSAI licence and optionally a GST certificate, stored privately. PAN and bank details go to our payment partner; we keep only the last four digits of the account.</li>
          <li><strong>Delivery partners:</strong> name, phone, vehicle, and their position, but only while they are delivering an order.</li>
        </ul>
      </section>

      <section>
        <h2>Who sees what</h2>
        <ul>
          <li>The shop sees your name, the order and the street address it is delivering to.</li>
          <li>The delivery partner sees your full delivery address and phone number for that order only.</li>
          <li>Our payment partner (Cashfree) handles online payments. We never see or store your card or UPI details.</li>
          <li>Our database and sign-in provider (Supabase) hosts the data. Google Maps is used to show maps where enabled.</li>
          <li>We do not sell your data and we do not show ads.</li>
        </ul>
      </section>

      <section>
        <h2>Your choices</h2>
        <ul>
          <li><strong>See your data:</strong> in <Link className="font-bold text-[var(--leaf-ink)] underline" href="/account">Your account</Link>, choose Download my data.</li>
          <li><strong>Delete your account:</strong> in Your account, choose Delete my account. Your name, phone, email, addresses, saved items and notifications are erased. Past orders are kept without anything that says who you are or where you live, because shops and payment records need them. You cannot delete while an order is still open.</li>
          <li><strong>Notifications:</strong> turn alerts off from the bell at any time.</li>
          <li><strong>Location:</strong> change or clear it from the location button at the top of the app.</li>
        </ul>
      </section>

      <section>
        <h2>Storage on your device</h2>
        <p>
          Localty keeps a sign-in session, your chosen location and your cart on your device so the site works. It does not use advertising or tracking cookies.
        </p>
      </section>

      <section>
        <h2>How long we keep things</h2>
        <p>
          Your account details stay until you delete the account. Order records are kept after that, without your personal details. Shop documents are kept while the shop is on Localty.
          Delivery partner positions are only the latest position, and are used only during a delivery.
        </p>
      </section>
    </LegalPage>
  );
}
