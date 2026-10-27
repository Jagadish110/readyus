import { z } from 'zod';

/**
 * Everything the service needs, checked once at start-up. A missing or
 * placeholder secret stops the process instead of failing on a customer's
 * first payment.
 */
const secret = (min: number) =>
  z
    .string()
    .min(min, `must be at least ${min} characters`)
    .refine((value) => !/^(your-|change-me|xxx)/i.test(value), 'still a placeholder value');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  // Loopback by default so a laptop is not exposed; set 0.0.0.0 in a container.
  HOST: z.string().default('127.0.0.1'),
  // Only set when a trusted proxy (Vercel, Render, nginx) sits in front.
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Browser origins allowed to call the API, comma separated.
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    ),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: secret(20),

  // Supabase → Connect → Transaction pooler. Optional so payments keep working
  // before it is set; the data routes answer 503 until it is.
  DATABASE_URL: z.string().url().optional(),

  // Cashfree → Developers → API Keys. Optional so the rest of the server runs before the
  // keys are added; payment routes answer 503 until both are set. The same secret key
  // also signs webhooks, so there is no separate webhook secret.
  CASHFREE_APP_ID: z.string().min(5).optional(),
  CASHFREE_SECRET_KEY: secret(10).optional(),
  // sandbox = test money, production = real money. Must match the keys (checked below).
  CASHFREE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  // For automated tests only: point at a local fake Cashfree. Ignored when NODE_ENV=production.
  CASHFREE_BASE_URL: z.string().url().optional(),
  CASHFREE_API_VERSION: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must look like 2025-01-01')
    .default('2025-01-01'),
  // Charge the one-off bank check Cashfree offers when a shop saves its bank details (fees apply).
  CASHFREE_VERIFY_VENDOR_BANK: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  // This server's public https address, used as Cashfree's webhook address on each order.
  PUBLIC_API_URL: z.string().url().optional(),
  // The website, used as the return address after paying.
  SITE_URL: z.string().url().default('http://localhost:3000'),

  // Browser notifications (Web Push). Generate a pair once with `npm run vapid` and keep the private
  // key secret. Optional: without them the bell and inbox still work, only the pop-up alerts are off.
  VAPID_PUBLIC_KEY: z.string().min(60).optional(),
  VAPID_PRIVATE_KEY: secret(30).optional(),
  // How the browser vendors can reach you if your pushes misbehave: mailto:you@yourdomain or an https address.
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, 'must look like mailto:you@example.com')
    .default('mailto:support@localty.in'),
  // For automated tests and local fakes only: accept push addresses on any host. Ignored in production.
  PUSH_ALLOW_ANY_HOST: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // Protects the scheduled refund sweep.
  CRON_SECRET: secret(16)
});

const checked = schema.superRefine((value, ctx) => {
  const { CASHFREE_APP_ID: id, CASHFREE_SECRET_KEY: key, CASHFREE_ENV: env } = value;
  if (Boolean(id) !== Boolean(key)) {
    ctx.addIssue({ code: 'custom', path: ['CASHFREE_APP_ID'], message: 'set both CASHFREE_APP_ID and CASHFREE_SECRET_KEY, or neither' });
  }
  // Cashfree secret keys carry their mode, so a mix-up is caught here instead of on a customer's payment.
  if (key && env === 'production' && key.includes('_test_')) {
    ctx.addIssue({ code: 'custom', path: ['CASHFREE_ENV'], message: 'CASHFREE_ENV is production but the secret key is a TEST key' });
  }
  if (Boolean(value.VAPID_PUBLIC_KEY) !== Boolean(value.VAPID_PRIVATE_KEY)) {
    ctx.addIssue({ code: 'custom', path: ['VAPID_PUBLIC_KEY'], message: 'set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither' });
  }
  if (key && env === 'sandbox' && key.includes('_prod_')) {
    ctx.addIssue({ code: 'custom', path: ['CASHFREE_ENV'], message: 'CASHFREE_ENV is sandbox but the secret key is a PRODUCTION key' });
  }
});

// A line like `PUBLIC_API_URL=` in .env (copied from the template) means "not set", not an empty value.
const parsed = checked.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')));
if (!parsed.success) {
  // Names and reasons only; never print the values.
  const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
  console.error(`Invalid configuration:\n${problems}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === 'production';
