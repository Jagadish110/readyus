import { describe, expect, it } from 'vitest';
import { kycFields, kycSchema } from '../src/lib/kyc.js';

// Sample values from Cashfree's own sample-easy-split-v3.csv.
describe('vendor KYC', () => {
  it('maps each ID proof to the field Cashfree reads', () => {
    const cases = [
      ['aadhaar', '3675 9834 6012', { uidai: '367598346012' }],
      ['voter_id', 'uai4574761', { voter_id: 'UAI4574761' }],
      ['driving_license', 'KA01-20198900984', { driving_license: 'KA0120198900984' }],
      ['passport', 'A2096457', { passport_number: 'A2096457' }]
    ] as const;
    for (const [idProofType, idProofNumber, expected] of cases) {
      expect(kycFields(kycSchema.parse({ idProofType, idProofNumber }))).toEqual(expected);
    }
  });

  it('sends a GSTIN as gst, and nothing when the fields are empty', () => {
    expect(kycFields(kycSchema.parse({ gstin: '29aaicp2912r1zr' }))).toEqual({ gst: '29AAICP2912R1ZR' });
    expect(kycFields(kycSchema.parse({ idProofNumber: '', gstin: '' }))).toEqual({});
  });

  it('rejects a number that does not fit the chosen ID, or a number with no ID chosen', () => {
    expect(() => kycSchema.parse({ idProofType: 'aadhaar', idProofNumber: '12345' })).toThrow(/12 digits/);
    expect(() => kycSchema.parse({ idProofType: 'passport', idProofNumber: 'AB123' })).toThrow(/passport/i);
    expect(() => kycSchema.parse({ idProofNumber: '367598346012' })).toThrow(/Choose which ID/);
    expect(() => kycSchema.parse({ gstin: '29AAICP2912R1Z' })).toThrow(/GSTIN/);
  });
});
