import { defineConfig } from '@playwright/test';

// Browser smoke tests. Start the stack first (see e2e/start-stack.sh); CI does this for you.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:3100', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' }
});
