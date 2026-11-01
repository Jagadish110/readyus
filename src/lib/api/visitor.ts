/**
 * Server side only: reads INTERNAL_API_KEY, which is not a NEXT_PUBLIC_ value and so never reaches a
 * browser bundle. Not marked 'server-only' because the proxy imports it too.
 */

/** The header the host fills with the visitor's address and that callers cannot set themselves. */
function clientIpHeader() {
  return process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || (process.env.VERCEL ? 'x-real-ip' : 'cf-connecting-ip');
}

/**
 * Headers for a call this server makes to the backend while handling a visitor's request. Every such call
 * leaves from this server's address, so without them all visitors would share one rate limit; with them
 * the backend limits each visitor on their own. Nothing is added until INTERNAL_API_KEY is set.
 */
export function visitorHeaders(incoming: { get(name: string): string | null }): Record<string, string> {
  const key = process.env.INTERNAL_API_KEY;
  const ip = incoming.get(clientIpHeader())?.trim() ?? '';
  // The backend validates the address; this only keeps junk out of the header.
  if (!key || !/^[0-9a-f:.]{3,45}$/i.test(ip)) return {};
  return { 'x-localty-internal-key': key, 'x-localty-client-ip': ip };
}
