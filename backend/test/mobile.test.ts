import { describe, expect, it } from 'vitest';
import { mobileNumber } from '../src/routes/customer.js';

describe('mobile number at checkout', () => {
  it('accepts the ways people write an Indian mobile number, and stores the 10 digits', () => {
    for (const written of ['9876543210', '98765 43210', '+91 98765-43210', '919876543210', '09876543210', '(98765) 43210']) {
      expect(mobileNumber.parse(written)).toBe('9876543210');
    }
  });

  it('refuses anything a shop could not call', () => {
    for (const bad of ['', '12345', '1234567890', '5876543210', 'abcdefghij', '98765432101', '+1 415 555 0100']) {
      expect(mobileNumber.safeParse(bad).success).toBe(false);
    }
  });
});
