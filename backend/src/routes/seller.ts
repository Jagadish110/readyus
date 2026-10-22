import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/auth.js';
import { asService } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { razorpay, toPayoutStatus, type PayoutStatus } from '../lib/razorpay.js';

/** Only needed the first time, when the Razorpay account is created. */
const identitySchema = z.object({
  businessType: z.enum(['individual', 'proprietorship']),
  contactName: z.string().trim().min(2).max(80),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN, like ABCDE1234F.'),
  state: z.string().trim().min(2).max(60)
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
  address: string;
  city: string;
  pincode: string;
  status: string;
  listing_mode: 'food' | 'items';
};

type Stored = {
  razorpay_account_id: string;
  razorpay_product_id: string | null;
  status: PayoutStatus;
  status_detail: string;
  business_type: string | null;
  beneficiary_name: string | null;
  bank_ifsc: string | null;
  bank_last4: string | null;
};

type Product = {
  id: string;
  activation_status?: string;
  requirements?: Array<{ field_reference?: string }>;
};

/** Razorpay wants a street of at least 10 characters. */
const pad = (value: string, city: string) => (value.length >= 10 ? value : `${value}, ${city}`.padEnd(10, '.'));

/** The caller's own shop, found by who they are, never by an id they sent. */
async function shopOf(userId: string): Promise<Shop> {
  const shop = await asService((q) =>
    q.one<Shop>(
      'select id, shop_name, phone, address, city, pincode, status, listing_mode from sellers where user_id = $1',
      [userId]
    )
  );
  if (!shop) throw new AppError(404, 'Create your shop first.');
  return shop;
}

const getAccount = (sellerId: string) =>
  asService((q) =>
    q.one<Stored>(
      `select razorpay_account_id, razorpay_product_id, status, status_detail, business_type,
              beneficiary_name, bank_ifsc, bank_last4
       from seller_payout_accounts where seller_id = $1`,
      [sellerId]
    )
  );

export const sellerRoutes: FastifyPluginAsync = async (app) => {
  /**
   * The shop's payout status for the Payouts page. Only what the owner needs:
   * never the Razorpay account id, and never a full account number.
   */
  app.get('/payout', async (request) => {
    const user = await requireUser(request);
    const shop = await shopOf(user.id);

    let stored = await getAccount(shop.id);
    if (!stored) return { account: null };

    // While Razorpay is still reviewing, ask it for the latest so the page is never stale.
    if (stored.status !== 'activated' && stored.razorpay_product_id) {
      try {
        const live = await razorpay<Product>(
          `/accounts/${stored.razorpay_account_id}/products/${stored.razorpay_product_id}`,
          undefined,
          { version: 'v2' }
        );
        const status = toPayoutStatus(live.activation_status);
        const detail = (live.requirements ?? [])
          .map((item) => item.field_reference?.replace(/_/g, ' '))
          .filter(Boolean)
          .join(', ');
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
   * Saves a shop's bank details by creating (or updating) its Razorpay Route
   * linked account. The account number and PAN go to Razorpay and are never
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

    let accountId = existing?.razorpay_account_id;
    let productId = existing?.razorpay_product_id ?? null;

    if (!accountId && identity) {
      const phone = shop.phone.replace(/\D/g, '').slice(-10);
      const account = await razorpay<{ id: string }>(
        '/accounts',
        {
          email: user.email,
          phone,
          type: 'route',
          reference_id: shop.id,
          legal_business_name: shop.shop_name,
          business_type: identity.businessType,
          contact_name: identity.contactName,
          profile: {
            category: shop.listing_mode === 'food' ? 'food' : 'ecommerce',
            subcategory: shop.listing_mode === 'food' ? 'restaurant' : 'grocery',
            addresses: {
              registered: {
                street1: pad(shop.address, shop.city),
                street2: pad(shop.shop_name, shop.city),
                city: shop.city,
                state: identity.state,
                postal_code: shop.pincode,
                country: 'IN'
              }
            }
          },
          legal_info: { pan: identity.pan }
        },
        { version: 'v2' }
      );
      accountId = account.id;

      // Saved straight away so a failure further down resumes instead of duplicating.
      await asService((q) =>
        q.rows(
          `insert into seller_payout_accounts (seller_id, razorpay_account_id, status, business_type)
           values ($1, $2, 'created', $3)`,
          [shop.id, accountId, identity.businessType]
        )
      );

      if (identity.businessType === 'proprietorship') {
        await razorpay(
          `/accounts/${accountId}/stakeholders`,
          { name: identity.contactName, email: user.email, kyc: { pan: identity.pan } },
          { version: 'v2' }
        );
      }
    }

    if (!accountId) throw new AppError(500, 'Could not set up your payout account.');

    if (!productId) {
      const product = await razorpay<Product>(
        `/accounts/${accountId}/products`,
        { product_name: 'route', tnc_accepted: true },
        { version: 'v2' }
      );
      productId = product.id;
      await asService((q) =>
        q.rows('update seller_payout_accounts set razorpay_product_id = $2 where seller_id = $1', [shop.id, productId])
      );
    }

    const configured = await razorpay<Product>(
      `/accounts/${accountId}/products/${productId}`,
      {
        settlements: {
          account_number: bank.accountNumber,
          ifsc_code: bank.ifsc,
          beneficiary_name: bank.beneficiaryName
        },
        tnc_accepted: true
      },
      { version: 'v2', method: 'PATCH' }
    );

    await asService((q) =>
      q.rows(
        `update seller_payout_accounts
            set status = $2, status_detail = '', beneficiary_name = $3, bank_ifsc = $4, bank_last4 = $5
          where seller_id = $1`,
        [shop.id, toPayoutStatus(configured.activation_status), bank.beneficiaryName, bank.ifsc, bank.accountNumber.slice(-4)]
      )
    );

    return { ok: true };
  });
};
