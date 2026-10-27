import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newSubscriptionId, readPayment, mandateInPlace } from '../src/lib/billing.js';
import { toPayoutStatus, toPaise, toRupees, verifyWebhookSignature } from '../src/lib/cashfree.js';
import { findSubscriptionId } from '../src/routes/webhooks.js';

const KEY = 'cfsk_ma_test_0123456789abcdef';
const sign = (timestamp: string, body: string) => createHmac('sha256', KEY).update(timestamp + body).digest('base64');

describe('webhook signature', () => {
  const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
  const now = String(Date.now());

  it('accepts a correct signature', () => {
    expect(verifyWebhookSignature(body, now, sign(now, body))).toBe(true);
  });

  it('rejects a changed body, a wrong signature and missing parts', () => {
    expect(verifyWebhookSignature(body + ' ', now, sign(now, body))).toBe(false);
    expect(verifyWebhookSignature(body, now, 'bm9wZQ==')).toBe(false);
    expect(verifyWebhookSignature(body, '', sign('', body))).toBe(false);
    expect(verifyWebhookSignature(body, now, '')).toBe(false);
  });

  it('rejects a captured webhook replayed an hour later', () => {
    const old = String(Date.now() - 60 * 60 * 1000);
    expect(verifyWebhookSignature(body, old, sign(old, body))).toBe(false);
  });
});

describe('money conversion', () => {
  it('round-trips rupees and paise without float drift', () => {
    expect(toPaise(499.99)).toBe(49999);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toRupees(49900)).toBe(499);
  });
});

describe('vendor status mapping', () => {
  it('maps Cashfree states to the few a shop sees', () => {
    expect(toPayoutStatus('ACTIVE')).toBe('activated');
    expect(toPayoutStatus('in_bank_validation')).toBe('under_review');
    expect(toPayoutStatus('BANK_VALIDATION_FAILED')).toBe('needs_clarification');
    expect(toPayoutStatus('ON_HOLD')).toBe('needs_clarification');
    expect(toPayoutStatus('BLOCKED')).toBe('rejected');
    expect(toPayoutStatus(undefined)).toBe('created');
  });
});

describe('subscription helpers', () => {
  it('finds the subscription id wherever Cashfree nests it', () => {
    expect(findSubscriptionId({ data: { subscription: { subscription_id: 'sub_abc' } } })).toBe('sub_abc');
    expect(findSubscriptionId({ data: { payment: { subscription_id: 'sub_x' } }, type: 'T' })).toBe('sub_x');
    expect(findSubscriptionId({ data: {} })).toBeNull();
    expect(findSubscriptionId({ subscription_id: 'has space' })).toBeNull();
    expect(findSubscriptionId(null)).toBeNull();
  });

  it('makes a Cashfree-safe, unique subscription id', () => {
    const a = newSubscriptionId('11111111-2222-3333-4444-555555555555', 1_000);
    const b = newSubscriptionId('11111111-2222-3333-4444-555555555555', 2_000);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
  });

  it('reads a payment across field-name variants', () => {
    const fallback = new Date('2026-01-01T00:00:00Z');
    expect(readPayment({ cf_payment_id: 77, payment_amount: 499, payment_completion_time: '2026-03-01T10:00:00Z' }, fallback)).toEqual({
      id: '77',
      amountPaise: 49900,
      paidAt: new Date('2026-03-01T10:00:00Z')
    });
    const bare = readPayment({ payment_id: 'p1', payment_amount: '499.00' }, fallback);
    expect(bare.id).toBe('p1');
    expect(bare.paidAt).toEqual(fallback);
    expect(readPayment({}, fallback).id).toBeNull();
  });

  it('treats a mandate waiting on the bank as already set up', () => {
    expect(mandateInPlace('ACTIVE')).toBe(true);
    expect(mandateInPlace('bank_approval_pending')).toBe(true);
    expect(mandateInPlace('INITIALIZED')).toBe(false);
    expect(mandateInPlace(null)).toBe(false);
  });
});
