import { describe, expect, it } from 'vitest';
import { maskUpi, upiId, upiSchema } from '../src/lib/upi.js';

describe('UPI payout details', () => {
  it('accepts the UPI IDs shops actually have, lower-cased', () => {
    for (const vpa of ['pistahouse@okhdfcbank', '9876543210@ybl', 'my.shop-1_x@paytm', 'shop@oksbi']) {
      expect(upiId.parse(vpa)).toBe(vpa);
    }
    expect(upiId.parse('  PistaHouse@OKHDFCBank ')).toBe('pistahouse@okhdfcbank');
  });

  it('refuses anything that is not a UPI ID', () => {
    for (const bad of ['', 'pistahouse', '@okhdfcbank', 'pista house@ybl', 'a@ybl', 'shop@1bank', 'shop@ybl@x', 'shop@']) {
      expect(upiId.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('needs the name on the account too', () => {
    expect(upiSchema.safeParse({ upiId: 'shop@ybl' }).success).toBe(false);
    expect(upiSchema.parse({ upiId: 'shop@ybl', upiHolder: ' Ravi Kumar ' })).toEqual({ upiId: 'shop@ybl', upiHolder: 'Ravi Kumar' });
  });

  it('keeps only enough to recognise it', () => {
    expect(maskUpi('pistahouse@okhdfcbank')).toBe('pi•••@okhdfcbank');
    expect(maskUpi('9876543210@ybl')).toBe('98•••@ybl');
  });
});
