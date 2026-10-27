import { describe, expect, it } from 'vitest';
import { documentSchema, isValidGstin, todayInIndia } from '../src/lib/documents.js';

describe('GSTIN', () => {
  it('accepts a correct GSTIN, including its check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin(' 27aapfu0939f1zv ')).toBe(true);
  });

  it('rejects a wrong check character, a wrong shape and rubbish', () => {
    expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
    expect(isValidGstin('ABAAPFU0939F1ZV')).toBe(false);
    expect(isValidGstin('')).toBe(false);
  });
});

describe('document form', () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const path = 'shop-id/fssai-abc.pdf';

  it('accepts a 14-digit FSSAI number with a future expiry', () => {
    const parsed = documentSchema.parse({ kind: 'fssai', number: '12345678901234', validUntil: tomorrow, path });
    expect(parsed.kind).toBe('fssai');
  });

  it('rejects a short FSSAI number, a missing expiry and an expired licence', () => {
    expect(() => documentSchema.parse({ kind: 'fssai', number: '1234567890123', validUntil: tomorrow, path })).toThrow(/14 digits/);
    expect(() => documentSchema.parse({ kind: 'fssai', number: '12345678901234', path })).toThrow();
    expect(() => documentSchema.parse({ kind: 'fssai', number: '12345678901234', validUntil: '2020-01-01', path })).toThrow(/expired/);
  });

  it('judges "today" on the Indian calendar', () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in India.
    expect(todayInIndia(new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
    expect(todayInIndia(new Date('2026-12-31T10:00:00Z'))).toBe('2026-12-31');
  });

  it('checks the GSTIN and does not need an expiry for it', () => {
    expect(documentSchema.parse({ kind: 'gst', number: '27aapfu0939f1zv', path })).toMatchObject({ number: '27AAPFU0939F1ZV' });
    expect(() => documentSchema.parse({ kind: 'gst', number: '27AAPFU0939F1ZW', path })).toThrow(/GSTIN/);
  });
});
