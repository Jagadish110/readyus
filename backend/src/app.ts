import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config, isProduction } from './config.js';
import { AppError } from './lib/errors.js';
import { CashfreeError } from './lib/cashfree.js';
import { customerRoutes } from './routes/customer.js';
import { paymentRoutes } from './routes/payments.js';
import { webhookRoutes } from './routes/webhooks.js';
import { sellerRoutes } from './routes/seller.js';
import { sellerConsoleRoutes } from './routes/seller-console.js';
import { internalRoutes } from './routes/internal.js';
import { publicRoutes } from './routes/public.js';
import { accountRoutes } from './routes/account.js';
import { riderRoutes } from './routes/rider.js';
import { adminRoutes } from './routes/admin.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The exact bytes received, needed to check Cashfree's webhook signature. */
    rawBody?: string;
  }
}

export async function buildApp() {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 100 * 1024,
    logger: {
      level: isProduction ? 'info' : 'debug',
      // Credentials and signatures never reach the logs.
      redact: ['req.headers.authorization', 'req.headers["x-webhook-signature"]', 'req.headers.cookie']
    }
  });

  await app.register(helmet);

  // Only the Localty site may call this from a browser.
  await app.register(cors, {
    origin: config.ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600
  });

  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });

  // Keep the raw body next to the parsed one; the webhook signature covers the raw bytes.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(new AppError(400, 'Invalid JSON.'), undefined);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send({ error: error.message, code: error.code });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: error.issues[0]?.message ?? 'Check the details and try again.' });
    }
    if (error instanceof CashfreeError) {
      // Cashfree's own message is written for the merchant (for example "bank details invalid"), so it is passed on.
      request.log.warn({ cashfreeStatus: error.status, cashfreeCode: error.code }, error.message);
      return reply.code(error.status >= 400 && error.status < 500 ? 422 : 502).send({ error: error.message });
    }
    // Rate limit, payload too large and similar framework errors keep their status.
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (error as Error).message });
    }
    // Anything else is a bug or an outage: log it here, tell the caller nothing.
    request.log.error(error);
    return reply.code(500).send({ error: 'Something went wrong. Please try again.' });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found.' }));

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(customerRoutes, { prefix: '/v1' });
  await app.register(paymentRoutes, { prefix: '/v1/payments' });
  await app.register(webhookRoutes, { prefix: '/v1/webhooks' });
  await app.register(sellerRoutes, { prefix: '/v1/seller' });
  await app.register(sellerConsoleRoutes, { prefix: '/v1/seller' });
  await app.register(publicRoutes, { prefix: '/v1/public' });
  await app.register(accountRoutes, { prefix: '/v1' });
  await app.register(riderRoutes, { prefix: '/v1/rider' });
  await app.register(adminRoutes, { prefix: '/v1/admin' });
  await app.register(internalRoutes, { prefix: '/internal' });

  return app;
}
