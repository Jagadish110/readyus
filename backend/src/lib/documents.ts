import { z } from 'zod';

/**
 * Format rules for the numbers shops give us. These catch typos before a reviewer spends time on
 * them; whether a licence is real and current is still decided by a person looking at the file.
 */

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A GSTIN is 15 characters; the last one is a check character over the first 14. */
export function isValidGstin(value: string): boolean {
  const gstin = value.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) return false;

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(gstin[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === gstin[14];
}

/** Today's date in India, as YYYY-MM-DD, so "expires today" is judged the way the owner reads their certificate. */
export function todayInIndia(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

export const DOCUMENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
};

const fssai = z.object({
  kind: z.literal('fssai'),
  number: z
    .string()
    .trim()
    .regex(/^[0-9]{14}$/, 'An FSSAI number has exactly 14 digits.'),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the expiry date from your certificate.')
    .refine((value) => value >= todayInIndia(), 'This licence has already expired. Upload the renewed one.')
});

const gst = z.object({
  kind: z.literal('gst'),
  number: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidGstin, 'That GSTIN does not look right. Check all 15 characters.'),
  validUntil: z.string().optional()
});

export const documentSchema = z.discriminatedUnion('kind', [fssai, gst]).and(z.object({ path: z.string().min(10).max(300) }));
