import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { cashfree, toPayoutStatus, type PayoutStatus } from '../lib/cashfree.js';

/** Only needed the first time, when the Cashfree vendor is created. */
const identitySchema = z.object({
  businessType: z.enum(['individual', 'proprietorship']),
  contactName: z.string().trim().min(2).max(80),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN, like ABCDE1234F.'),
  // Collected by the form but not needed by Cashfree.
  state: z.string().trim().max(60).optional()
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

type Shop = {
  id: string;
  shop_name: string;
  phone: string;
  status: string;
};

type Stored = {
  cashfree_vendor_id: string;
  status: PayoutStatus;
  status_detail: string;
  business_type: string | null;
  beneficiary_name: string | null;
  bank_ifsc: string | null;
  bank_last4: string | null;
};

type Vendor = {
  vendor_id: string;
  status?: string;
  /** Cashfree's reasons for a failed bank or KYC check, when it gives any. */
  remarks?: string;
};

/** The caller's own shop, found by who they are, never by an id they sent. */
async function shopOf(userId: string): Promise<Shop> {
  const shop = await asService((q) =>
    q.one<Shop>(
      'select id, shop_name, phone, status from sellers where user_id = $1',
      [userId]
    )
  );
  if (!shop) throw new AppError(404, 'Create your shop first.');
  return shop;
}

const getAccount = (sellerId: string) =>
  asService((q) =>
    q.one<Stored>(
      `select cashfree_vendor_id, status, status_detail, business_type,
              beneficiary_name, bank_ifsc, bank_last4
       from seller_payout_accounts where seller_id = $1`,
      [sellerId]
    )
  );

export const sellerRoutes: FastifyPluginAsync = async (app) => {
  /**
   * The shop's payout status for the Payouts page. Only what the owner needs:
   * never the Cashfree vendor id, and never a full account number.
   */
  app.get('/payout', async (request) => {
    const user = await requireUser(request);
    const shop = await shopOf(user.id);

    let stored = await getAccount(shop.id);
    if (!stored) return { account: null };

    // While Cashfree is still verifying, ask it for the latest so the page is never stale.
    if (stored.status !== 'activated') {
      try {
        const live = await cashfree<Vendor>(`/easy-split/vendors/${encodeURIComponent(stored.cashfree_vendor_id)}`);
        const status = toPayoutStatus(live.status);
        const detail = status === 'activated' ? '' : (live.remarks ?? '');
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
   * Saves a shop's bank details by creating (or updating) its Cashfree Easy
   * Split vendor. The account number and PAN go to Cashfree and are never
   * stored or logged here; only the last four digits are kept for display.
   */
  app.post('/payout', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) => {
    const user = await requireUser(request);
    const bank = bankSchema.parse(request.body);

    const shop = await shopOf(user.id);
    if (shop.status !== 'approved') {
      throw new AppError(409, 'Your shop must be approved before you add bank details.');
    }

    const existing = await getAccount(shop.id);
    // Required only on the first save.
    const identity = existing ? null : identitySchema.parse(request.body);

    const bankBody = {
      account_number: bank.accountNumber,
      account_holder: bank.beneficiaryName,
      ifsc: bank.ifsc
    };

    let vendor: Vendor;
    if (existing) {
      vendor = await cashfree<Vendor>(
        `/easy-split/vendors/${encodeURIComponent(existing.cashfree_vendor_id)}`,
        { bank: bankBody, verify_account: true },
        { method: 'PATCH' }
      );
    } else if (identity) {
      const vendorId = shop.id;
      vendor = await cashfree<Vendor>('/easy-split/vendors', {
        vendor_id: vendorId,
        status: 'ACTIVE',
        name: shop.shop_name,
        email: user.email,
        phone: shop.phone.replace(/\D/g, '').slice(-10),
        verify_account: true,
        dashboard_access: false,
        schedule_option: 1,
        bank: bankBody,
        kyc_details: {
          account_type: identity.businessType === 'individual' ? 'Individual' : 'Proprietorship',
          business_type: 'Restaurant',
          pan: identity.pan
        }
      });

      await asService((q) =>
        q.rows(
          `insert into seller_payout_accounts (seller_id, cashfree_vendor_id, status, business_type)
           values ($1, $2, 'created', $3)`,
          [shop.id, vendorId, identity.businessType]
        )
      );
    } else {
      throw new AppError(500, 'Could not set up your payout account.');
    }

    await asService((q) =>
      q.rows(
        `update seller_payout_accounts
            set status = $2, status_detail = '', beneficiary_name = $3, bank_ifsc = $4, bank_last4 = $5
          where seller_id = $1`,
        [shop.id, toPayoutStatus(vendor.status), bank.beneficiaryName, bank.ifsc, bank.accountNumber.slice(-4)]
      )
    );

    return { ok: true };
  });
};
