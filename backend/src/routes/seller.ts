import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { requireUser } from '../lib/auth.js';
import {
  cashfree,
  CashfreeError,
  payoutDetail,
  toPayoutStatus,
  type CashfreeVendor,
  type PayoutStatus
} from '../lib/cashfree.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { kycFields, kycSchema } from '../lib/kyc.js';
import { maskUpi, upiSchema } from '../lib/upi.js';

/** Only needed the first time, when the shop becomes a Cashfree vendor. */
const identitySchema = z.object({
  // 'proprietorship' is what earlier versions of the form sent; shops saved with it stay business accounts.
  businessType: z.enum(['individual', 'business', 'proprietorship']),
  contactName: z.string().trim().min(2).max(80),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN, like ABCDE1234F.')
});

const correctedPanSchema = z.object({
  pan: z
    .union([z.literal(''), identitySchema.shape.pan])
    .optional()
    .transform((value) => value || undefined)
});

type Shop = { id: string; shop_name: string; phone: string; status: string; listing_mode: 'food' | 'items' };

type Stored = {
  cashfree_vendor_id: string;
  status: PayoutStatus;
  status_detail: string;
  business_type: string | null;
  beneficiary_name: string | null;
  bank_ifsc: string | null;
  bank_last4: string | null;
  payout_method: 'bank' | 'upi';
  upi_display: string | null;
};

/** Cashfree allows letters, digits, spaces and . / - & in a vendor name. */
const cleanName = (value: string) => value.replace(/[^A-Za-z0-9 ./&-]/g, ' ').replace(/\s+/g, ' ').trim();

/** The caller's own shop, found by who they are, never by an id they sent. */
async function shopOf(userId: string): Promise<Shop> {
  const shop = await asService((q) =>
    q.one<Shop>('select id, shop_name, phone, status, listing_mode from sellers where user_id = $1', [userId])
  );
  if (!shop) throw new AppError(404, 'Create your shop first.');
  return shop;
}

const getAccount = (sellerId: string) =>
  asService((q) =>
    q.one<Stored>(
      `select cashfree_vendor_id, status, status_detail, business_type, beneficiary_name, bank_ifsc, bank_last4,
              payout_method, upi_display
       from seller_payout_accounts where seller_id = $1`,
      [sellerId]
    )
  );

const exists = (error: unknown) => error instanceof CashfreeError && /already (exist|present)|duplicate/i.test(error.message);

export const sellerRoutes: FastifyPluginAsync = async (app) => {
  /**
   * The shop's payout status for the Payouts page. Only what the owner needs: never the
   * vendor id, and never a full account number.
   */
  app.get('/payout', async (request) => {
    const user = await requireUser(request);
    const shop = await shopOf(user.id);

    let stored = await getAccount(shop.id);
    if (!stored) return { account: null };

    // While Cashfree is still checking, ask it for the latest so the page is never stale.
    if (stored.status !== 'activated') {
      try {
        const live = await cashfree<CashfreeVendor>('GET', `/easy-split/vendors/${encodeURIComponent(stored.cashfree_vendor_id)}`);
        const status = toPayoutStatus(live.status);
        const detail = payoutDetail(status, live);
        if (status !== stored.status || detail !== stored.status_detail) {
          await asService((q) =>
            q.rows('update seller_payout_accounts set status = $2, status_detail = $3 where seller_id = $1', [shop.id, status, detail])
          );
          stored = { ...stored, status, status_detail: detail };
        }
      } catch (cause) {
        request.log.warn({ cause }, 'could not refresh payout status');
      }
    }

    return {
      account: {
        status: stored.status,
        status_detail: stored.status_detail,
        business_type: stored.business_type,
        beneficiary_name: stored.beneficiary_name,
        bank_ifsc: stored.bank_ifsc,
        bank_last4: stored.bank_last4,
        payout_method: stored.payout_method,
        upi_display: stored.upi_display
      }
    };
  });

  /**
   * Saves a shop's UPI ID and KYC details by creating (or updating) its Cashfree Easy Split vendor.
   * Shops are paid to their UPI ID, which Cashfree verifies before the shop can take online payments.
   * (Shops set up earlier with a bank account keep it until they add a UPI ID.) The UPI ID, PAN and
   * ID numbers go to Cashfree and are never stored or logged here; only a masked UPI ID is kept.
   */
  app.post('/payout', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);

    const shop = await shopOf(user.id);
    if (shop.status !== 'approved') {
      throw new AppError(409, 'Your shop must be approved before you add your UPI ID.');
    }
    if (!user.email) throw new AppError(400, 'Add an email address to your account first; Cashfree needs one for payouts.');

    const existing = await getAccount(shop.id);
    // Required only on the first save.
    const identity = existing ? null : identitySchema.parse(request.body);
    const kyc = kycSchema.parse(request.body);
    if (identity?.businessType === 'business') {
      if (!kyc.cin) throw new AppError(400, 'Add your company’s CIN. Cashfree needs one besides the business PAN.');
    } else if (identity && !kyc.idProofNumber) {
      throw new AppError(400, 'Add an ID proof: Aadhaar, voter ID, driving licence or passport. Cashfree needs one besides the PAN.');
    }

    // Once the shop is a vendor the UPI ID can be left out, so an owner can send only a KYC fix:
    // Cashfree refuses payout changes while it is still setting up the first account.
    const body = (request.body ?? {}) as Record<string, unknown>;
    const upiGiven = ['upiHolder', 'upiId'].some((key) => String(body[key] ?? '').trim());
    const upi = existing && !upiGiven ? null : upiSchema.parse(request.body);

    const vendorId = existing?.cashfree_vendor_id ?? `shop_${shop.id.replace(/-/g, '')}`;
    const phone = shop.phone.replace(/\D/g, '').slice(-10);
    // Cashfree takes a UPI ID or a bank account, never both; a UPI ID replaces a bank account set up earlier.
    const upiBlock = upi && { vpa: upi.upiId, account_holder: upi.upiHolder };
    const payoutBlock = upiBlock ? { upi: upiBlock } : {};

    let vendor: CashfreeVendor;
    if (!identity) {
      // The PAN was fixed at creation; an owner whose PAN Cashfree rejected can send a corrected one.
      const correction = correctedPanSchema.parse(request.body).pan;
      const kycFix = { ...(correction ? { pan: correction } : {}), ...kycFields(kyc) };
      if (!upiBlock && !Object.keys(kycFix).length) {
        throw new AppError(400, 'Enter a new UPI ID, or the PAN or ID proof Cashfree asked for.');
      }
      vendor = await cashfree<CashfreeVendor>('PATCH', `/easy-split/vendors/${encodeURIComponent(vendorId)}`, {
        ...(upiBlock ? { ...payoutBlock, verify_account: config.CASHFREE_VERIFY_VENDOR_BANK } : {}),
        ...(Object.keys(kycFix).length ? { kyc_details: kycFix } : {})
      });
    } else {
      const kycDetails = {
        account_type: identity.businessType === 'individual' ? 'individual' : 'business_account',
        // Cashfree's business_type is the line of business, chosen from its own list (not the legal form).
        business_type: shop.listing_mode === 'food' ? 'Food and Beverages' : 'Retail and Shopping',
        pan: identity.pan,
        ...kycFields(kyc)
      };
      const create = {
        vendor_id: vendorId,
        status: 'ACTIVE',
        name: cleanName(identity.contactName),
        email: user.email,
        phone,
        verify_account: config.CASHFREE_VERIFY_VENDOR_BANK,
        dashboard_access: false,
        schedule_option: 1,
        ...payoutBlock,
        kyc_details: kycDetails
      };
      try {
        vendor = await cashfree<CashfreeVendor>('POST', '/easy-split/vendors', create);
      } catch (error) {
        // A first attempt reached Cashfree but not our database: carry on from there.
        if (!exists(error)) throw error;
        vendor = await cashfree<CashfreeVendor>('PATCH', `/easy-split/vendors/${encodeURIComponent(vendorId)}`, {
          ...payoutBlock,
          verify_account: config.CASHFREE_VERIFY_VENDOR_BANK,
          kyc_details: kycDetails
        });
      }
    }

    // A vendor Cashfree has not finished checking is "under review", never "activated".
    const status = vendor.status ? toPayoutStatus(vendor.status) : 'under_review';

    // What the owner sees on the Payouts page. A UPI ID replaces a bank account saved before.
    const shown = upi
      ? { method: 'upi', name: upi.upiHolder, ifsc: null, last4: null, upi: maskUpi(upi.upiId) }
      : {
          method: existing?.payout_method ?? 'bank',
          name: existing?.beneficiary_name ?? null,
          ifsc: existing?.bank_ifsc ?? null,
          last4: existing?.bank_last4 ?? null,
          upi: existing?.upi_display ?? null
        };

    await asService((q) =>
      q.rows(
        `insert into seller_payout_accounts
           (seller_id, cashfree_vendor_id, status, status_detail, business_type, beneficiary_name, bank_ifsc, bank_last4,
            payout_method, upi_display)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (seller_id) do update set
           status = excluded.status, status_detail = excluded.status_detail,
           beneficiary_name = excluded.beneficiary_name, bank_ifsc = excluded.bank_ifsc,
           bank_last4 = excluded.bank_last4, payout_method = excluded.payout_method,
           upi_display = excluded.upi_display, updated_at = now()`,
        [
          shop.id,
          vendorId,
          status,
          payoutDetail(status, vendor),
          identity?.businessType ?? existing?.business_type ?? null,
          shown.name,
          shown.ifsc,
          shown.last4,
          shown.method,
          shown.upi
        ]
      )
    );

    return { ok: true, status };
  });
};
