import { z } from 'zod';

/**
 * A UPI ID (VPA): a name, then "@", then the bank or app handle, like pistahouse@okhdfcbank or
 * 9876543210@ybl. NPCI allows letters, digits, dots, hyphens and underscores before the "@", and a
 * letters-first handle after it. Lower-cased, because UPI IDs are not case sensitive.
 */
export const upiId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/, 'Enter a valid UPI ID, like yourshop@okhdfcbank.');

export const upiSchema = z.object({
  upiHolder: z.string().trim().min(2).max(100),
  upiId
});

/**
 * What the owner sees afterwards: enough to recognise the UPI ID, not enough to reuse it.
 * "pistahouse@okhdfcbank" becomes "pi•••@okhdfcbank".
 */
export function maskUpi(vpa: string) {
  const at = vpa.lastIndexOf('@');
  return `${vpa.slice(0, Math.min(2, at))}•••${vpa.slice(at)}`;
}
