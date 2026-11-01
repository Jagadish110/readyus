/**
 * How long this server waits for the backend while rendering a page.
 *
 * A backend on a plan that sleeps when idle (Render's free plan) takes 30 to 60 seconds to wake up on the
 * first request after a quiet spell. A shorter limit turned every such wake-up into the "We hit a snag"
 * error page even though the backend answered moments later, so the wait covers a full cold start.
 * Not marked 'server-only' because the proxy imports it too.
 */
export const BACKEND_TIMEOUT_MS = 60_000;
