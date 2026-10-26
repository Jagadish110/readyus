import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { requireUser } from '../lib/auth.js';
import {
  cashfree,
  CashfreeError,
  toPayoutStatus,
  vendorProblem,
  type CashfreeVendor,
  type PayoutStatus
} from '../lib/cashfree.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

/** Only needed the first time, when the shop becomes a Cashfree vendor. */
const identitySchema = z.object({
  businessType: z.enum(['individual', 'proprietorship']),
  contactName: z.string().trim().min(2).max(80),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN, like ABCDE1234F.')
});

const bankSchema = z.object({
  beneficiaryName: z.string().trim().min(2).max(100),
  accountNumber: z.string().trim().regex(/^[0-9]{9,18}$/, 'Account number must be 9 to 18 digits.'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, like HDFC0001234.')
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
      `select cashfree_vendor_id, status, status_detail, business_type, beneficiary_name, bank_ifsc, bank_last4
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
        const detail = vendorProblem(live);
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
        beneficiary_name: stored.beneficiary_name,
        bank_ifsc: stored.bank_ifsc,
        bank_last4: stored.bank_last4
      }
    };
  });

  /**
   * Saves a shop's bank details by creating (or updating) its Cashfree Easy Split vendor.
   * The account number and PAN go to Cashfree and are never stored or logged here; only the
   * last four digits are kept for display.
   */
  app.post('/payout', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const bank = bankSchema.parse(request.body);

    const shop = await shopOf(user.id);
    if (shop.status !== 'approved') {
      throw new AppError(409, 'Your shop must be approved before you add bank details.');
    }
    if (!user.email) throw new AppError(400, 'Add an email address to your account first; Cashfree needs one for payouts.');

    const existing = await getAccount(shop.id);
    // Required only on the first save.
    const identity = existing ? null : identitySchema.parse(request.body);

    const vendorId = existing?.cashfree_vendor_id ?? `shop_${shop.id.replace(/-/g, '')}`;
    const phone = shop.phone.replace(/\D/g, '').slice(-10);
    const bankBlock = { account_number: bank.accountNumber, account_holder: bank.beneficiaryName, ifsc: bank.ifsc };

    let vendor: CashfreeVendor;
    if (!identity) {
      vendor = await cashfree<CashfreeVendor>('PATCH', `/easy-split/vendors/${encodeURIComponent(vendorId)}`, {
        bank: bankBlock,
        verify_account: config.CASHFREE_VERIFY_VENDOR_BANK
      });
    } else {
      const create = {
        vendor_id: vendorId,
        status: 'ACTIVE',
        name: cleanName(identity.contactName),
        email: user.email,
        phone,
        verify_account: config.CASHFREE_VERIFY_VENDOR_BANK,
        dashboard_access: false,
        schedule_option: 1,
        bank: bankBlock,
        kyc_details: {
          account_type: identity.businessType === 'individual' ? 'individual' : 'business_account',
          // Cashfree's business_type is the line of business, chosen from its own list (not the legal form).
          business_type: shop.listing_mode === 'food' ? 'Food and Beverages' : 'Retail and Shopping',
          pan: identity.pan
        }
      };
      try {
        vendor = await cashfree<CashfreeVendor>('POST', '/easy-split/vendors', create);
      } catch (error) {
        // A first attempt reached Cashfree but not our database: carry on from there.
        if (!exists(error)) throw error;
        vendor = await cashfree<CashfreeVendor>('PATCH', `/easy-split/vendors/${encodeURIComponent(vendorId)}`, {
          bank: bankBlock,
          verify_account: config.CASHFREE_VERIFY_VENDOR_BANK
        });
      }
    }

    // A vendor Cashfree has not finished checking is "under review", never "activated".
    const status = vendor.status ? toPayoutStatus(vendor.status) : 'under_review';

    await asService((q) =>
      q.rows(
        `insert into seller_payout_accounts
           (seller_id, cashfree_vendor_id, status, status_detail, business_type, beneficiary_name, bank_ifsc, bank_last4)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (seller_id) do update set
           status = excluded.status, status_detail = excluded.status_detail,
           beneficiary_name = excluded.beneficiary_name, bank_ifsc = excluded.bank_ifsc,
           bank_last4 = excluded.bank_last4, updated_at = now()`,
        [
          shop.id,
          vendorId,
          status,
          vendorProblem(vendor),
          identity?.businessType ?? existing?.business_type ?? null,
          bank.beneficiaryName,
          bank.ifsc,
          bank.accountNumber.slice(-4)
        ]
      )
    );

    return { ok: true, status };
  });
};
