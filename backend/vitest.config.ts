import webpush from 'web-push';
import { defineConfig } from 'vitest/config';

// A throwaway key pair for each test run; nothing real is ever signed with it.
const vapid = webpush.generateVAPIDKeys();

// src/config.ts validates the environment when it is imported, so the tests provide a complete,
// obviously fake one. Database tests run only when TEST_DATABASE_URL points at a throwaway
// Postgres (see test/db/setup.ts); everything else runs anywhere.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/db/setup.ts'],
    // One database, so files run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-0123456789',
      CRON_SECRET: 'test-cron-secret-0123456789',
      CASHFREE_APP_ID: 'test-app-id',
      CASHFREE_SECRET_KEY: 'cfsk_ma_test_0123456789abcdef',
      CASHFREE_ENV: 'sandbox',
      CASHFREE_BASE_URL: 'http://127.0.0.1:4599',
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? ''
    }
  }
});
