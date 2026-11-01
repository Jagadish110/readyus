import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { clientIp, rateLimitKey } from '../src/lib/client-ip.js';

// INTERNAL_API_KEY and CLIENT_IP_HEADER (cf-connecting-ip) come from vitest.config.ts.
const KEY = 'test-internal-key-0123456789abcdef0123';

/** What clientIp reads from a request; `ip` is the address Fastify worked out from the connection. */
const request = (headers: Record<string, string>, ip = '10.0.0.1') => ({ headers, ip }) as unknown as FastifyRequest;

describe('who a request is from', () => {
  it('takes the visitor the website server names, when it proves itself', () => {
    const fromSite = request({ 'x-localty-internal-key': KEY, 'x-localty-client-ip': '203.0.113.9' });
    expect(clientIp(fromSite)).toBe('203.0.113.9');
  });

  it('ignores a named visitor without the right key', () => {
    expect(clientIp(request({ 'x-localty-internal-key': `${KEY}x`, 'x-localty-client-ip': '203.0.113.9' }))).toBe('10.0.0.1');
    expect(clientIp(request({ 'x-localty-client-ip': '203.0.113.9' }))).toBe('10.0.0.1');
  });

  it('ignores a named visitor that is not an address', () => {
    expect(clientIp(request({ 'x-localty-internal-key': KEY, 'x-localty-client-ip': 'everyone' }))).toBe('10.0.0.1');
  });

  it("uses the edge's header, not the caller-written left of X-Forwarded-For", () => {
    expect(clientIp(request({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4' }))).toBe('198.51.100.7');
    expect(clientIp(request({ 'cf-connecting-ip': 'junk' }))).toBe('10.0.0.1');
  });
});

describe('rate-limit buckets', () => {
  it('keeps IPv4 addresses as they are', () => {
    expect(rateLimitKey(request({}, '192.0.2.1'))).toBe('192.0.2.1');
  });

  it('counts an IPv4 address written as IPv6 as the IPv4 address', () => {
    expect(rateLimitKey(request({}, '::ffff:192.0.2.1'))).toBe('192.0.2.1');
  });

  it('puts every address in one IPv6 /64 in one bucket', () => {
    const a = rateLimitKey(request({}, '2001:db8:abcd:12:1::5'));
    const b = rateLimitKey(request({}, '2001:DB8:ABCD:0012:ffff:ffff:ffff:1'));
    expect(a).toBe('2001:0db8:abcd:0012::/64');
    expect(b).toBe(a);
    expect(rateLimitKey(request({}, '2001:db8:abcd:13::1'))).not.toBe(a);
  });

  it('expands shortened forms before grouping', () => {
    expect(rateLimitKey(request({}, '2001:db8::1'))).toBe('2001:0db8:0000:0000::/64');
    expect(rateLimitKey(request({}, '::1'))).toBe('0000:0000:0000:0000::/64');
  });
});
