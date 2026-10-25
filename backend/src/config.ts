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

  // Cashfree → Developers → API keys. `sandbox` until you go live. Webhooks are
  // signed with the same secret key, so there is no separate webhook secret.
  CASHFREE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  CASHFREE_APP_ID: z.string().min(5),
  CASHFREE_SECRET_KEY: secret(10),
  // Where Cashfree sends the customer after a redirect-style payment (UPI apps).
  CASHFREE_RETURN_URL: z.string().url().optional(),

  // Protects the scheduled refund sweep.
  CRON_SECRET: secret(16)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Names and reasons only; never print the values.
  const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
  console.error(`Invalid configuration:\n${problems}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProduction = config.NODE_ENV === 'production';
