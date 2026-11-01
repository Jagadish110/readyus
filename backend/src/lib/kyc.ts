import { z } from 'zod';

/**
 * The KYC Cashfree asks of an Easy Split vendor besides the PAN. Every individual vendor needs an
 * address proof, and each kind goes in its own field; a GSTIN is optional. Formats catch typos
 * only: Cashfree decides whether a number is real. None of these are stored on our side.
 */
export const ID_PROOFS = {
  aadhaar: { field: 'uidai', pattern: /^[0-9]{12}$/, message: 'An Aadhaar number has 12 digits.' },
  voter_id: { field: 'voter_id', pattern: /^[A-Z]{3}[0-9]{7}$/, message: 'A voter ID looks like ABC1234567.' },
  driving_license: {
    field: 'driving_license',
    pattern: /^[A-Z]{2}[0-9]{2}[0-9A-Z]{9,13}$/,
    message: 'Enter the driving licence number as printed, like KA0120198900984.'
  },
  passport: { field: 'passport_number', pattern: /^[A-Z][0-9]{7}$/, message: 'A passport number looks like A1234567.' }
} as const;

/** Spaces and dashes are how people copy these off a card; Cashfree wants them without. */
const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.replace(/[\s-]/g, '').toUpperCase() || undefined);

export const kycSchema = z
  .object({
    idProofType: z.enum(['aadhaar', 'voter_id', 'driving_license', 'passport']).optional(),
    idProofNumber: optionalText,
    gstin: optionalText.refine(
      (value) => !value || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value),
      'Enter a valid 15-character GSTIN, like 29AAICP2912R1ZR.'
    )
  })
  .superRefine((value, ctx) => {
    if (value.idProofNumber && !value.idProofType) {
      ctx.addIssue({ code: 'custom', path: ['idProofType'], message: 'Choose which ID the number is from.' });
    } else if (value.idProofType && value.idProofNumber && !ID_PROOFS[value.idProofType].pattern.test(value.idProofNumber)) {
      ctx.addIssue({ code: 'custom', path: ['idProofNumber'], message: ID_PROOFS[value.idProofType].message });
    }
  });

export type Kyc = z.infer<typeof kycSchema>;

/** The KYC fields as Cashfree names them, ready to spread into `kyc_details`. */
export function kycFields(kyc: Kyc): Record<string, string> {
  return {
    ...(kyc.idProofType && kyc.idProofNumber ? { [ID_PROOFS[kyc.idProofType].field]: kyc.idProofNumber } : {}),
    ...(kyc.gstin ? { gst: kyc.gstin } : {})
  };
}
