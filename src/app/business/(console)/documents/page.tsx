import type { Metadata } from 'next';
import { requireShop } from '@/lib/business/shop';
import { loadDocuments } from '@/lib/business/documents';
import { DocumentCard } from '@/components/business/document-card';
import { Card, Eyebrow } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Verification documents' };
export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const { shop } = await requireShop();
  const info = await loadDocuments();
  const food = shop.listing_mode === 'food';

  return (
    <div className="animate-rise grid gap-5">
      <div>
        <Eyebrow>{shop.shop_name}</Eyebrow>
        <h1 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-extrabold tracking-[-0.045em]">
          Verification documents
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          We check these once, so customers can trust the shops on Localty. Files are private: only our review team can open them.
        </p>
      </div>

      {!info ? (
        <Card className="p-5 sm:p-6">
          <p className="text-sm text-[var(--text-muted)]">We could not load your documents right now. Please try again in a moment.</p>
        </Card>
      ) : (
        <>
          {food && info.dueAt && !info.documents.some((doc) => doc.kind === 'fssai' && doc.status === 'approved') && (
            <Card className="p-5 ring-1 ring-warning/35 sm:p-6">
              <p className="text-sm leading-relaxed">
                Your shop is live today. Add your FSSAI licence by{' '}
                <strong>{new Date(info.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</strong> to stay visible to customers.
              </p>
            </Card>
          )}

          <DocumentCard
            kind="fssai"
            title="FSSAI licence or registration"
            required={food}
            why={
              food
                ? 'Indian law requires every food business to hold an FSSAI licence or registration, and platforms must show the number to customers. Your shop cannot be approved or stay visible without a valid one.'
                : 'Needed if you sell any packaged or fresh food. Everyday-item shops that sell no food can skip it.'
            }
            numberLabel="FSSAI number"
            numberHint="14 digits, printed on your certificate."
            numberPattern="[0-9]{14}"
            needsExpiry
            existing={info.documents.find((doc) => doc.kind === 'fssai')}
          />

          <DocumentCard
            kind="gst"
            title="GST registration"
            required={false}
            why="Add your GSTIN if your business is registered for GST. Shops that sell goods through an online platform often must be; your accountant can confirm. We store it so tax paperwork can be matched to your shop."
            numberLabel="GSTIN"
            numberHint="15 characters, like 27AAPFU0939F1ZV."
            numberPattern="[0-9A-Za-z]{15}"
            needsExpiry={false}
            existing={info.documents.find((doc) => doc.kind === 'gst')}
          />

          <Card className="grid gap-2 p-5 text-sm leading-relaxed text-[var(--text-muted)] sm:p-6">
            <h2 className="font-display text-base font-extrabold tracking-[-0.025em] text-[var(--text)]">Already checked elsewhere</h2>
            <p>
              <strong className="text-[var(--text)]">PAN and bank account:</strong> you give these on the Payouts page, and our payment
              partner verifies them before you can be paid online.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
