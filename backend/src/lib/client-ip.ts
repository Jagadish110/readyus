import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';

const single = (value: string | string[] | undefined) => (typeof value === 'string' ? value.trim() : '');

function sameSecret(given: string, expected: string) {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The visitor a request is really from.
 *
 *  - The website's own server renders pages for many visitors from one address. It proves itself with
 *    INTERNAL_API_KEY and names the visitor in x-localty-client-ip.
 *  - Otherwise the header the host's edge sets (CLIENT_IP_HEADER), then the address Fastify works out.
 */
export function clientIp(request: FastifyRequest): string {
  const key = config.INTERNAL_API_KEY;
  const visitor = single(request.headers['x-localty-client-ip']);
  if (key && isIP(visitor) && sameSecret(single(request.headers['x-localty-internal-key']), key)) return visitor;

  if (config.CLIENT_IP_HEADER) {
    const edge = single(request.headers[config.CLIENT_IP_HEADER]);
    if (isIP(edge)) return edge;
  }
  return request.ip;
}

/**
 * The rate-limit bucket for a request: its visitor's address. An IPv6 visitor usually holds a whole /64,
 * so the /64 is limited as one; an IPv4 address written in IPv6 form counts as the IPv4 address.
 */
export function rateLimitKey(request: FastifyRequest): string {
  const ip = clientIp(request).toLowerCase();
  if (isIP(ip) !== 6) return ip;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped?.[1]) return mapped[1];

  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, '0'))
    .join(':')}::/64`;
}
