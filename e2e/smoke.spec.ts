import { expect, test, type BrowserContext } from '@playwright/test';

const b64url = (s: string) => Buffer.from(s).toString('base64url');
const PEOPLE = {
  customer: { token: 'tok-customer', id: '11111111-1111-4111-8111-111111111111', email: 'asha@example.test' },
  admin: { token: 'tok-admin', id: '55555555-5555-4555-8555-555555555555', email: 'admin@example.test' },
  owner: { token: 'tok-owner', id: 'ec258de3-b60b-4883-a7db-8d49c252f66a', email: 'paradise@readyus.test' }
};

/** Signs the browser in as one of the seeded people, the way Supabase's own cookie would. */
async function signInAs(context: BrowserContext, who: keyof typeof PEOPLE) {
  const u = PEOPLE[who];
  // The signature only has to carry the stub's token name, but it must decode as base64url: the website's
  // getClaims() check rejects a token whose parts do not, before it ever asks the sign-in stub.
  const signature = `sig-${u.token}`.padEnd(Math.ceil((u.token.length + 4) / 4) * 4, 'A');
  const jwt = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: u.id, role: 'authenticated', exp: 4102444800 }))}.${signature}`;
  const session = {
    access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
    user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  };
  await context.addCookies([
    { name: 'sb-localhost-auth-token', value: 'base64-' + b64url(JSON.stringify(session)), url: 'http://localhost:3100' },
    { name: 'readyus-loc', value: encodeURIComponent(JSON.stringify({ lat: 17.385, lng: 78.4867, label: 'Test area', radiusKm: 5 })), url: 'http://localhost:3100' }
  ]);
  await context.addInitScript(() => {
    try { localStorage.setItem('readyus-location', JSON.stringify({ lat: 17.385, lng: 78.4867, label: 'Test area', radiusKm: 5 })); } catch {}
  });
}

test.describe('public pages', () => {
  test('policies are readable without signing in', async ({ page }) => {
    for (const path of ['/legal/terms', '/legal/privacy', '/legal/refunds']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('the business area asks you to sign in', async ({ page }) => {
    await page.goto('/business');
    await expect(page).toHaveURL(/sign-in|auth/);
  });
});

test.describe('customer', () => {
  test('sees shops near them', async ({ context, page }) => {
    await signInAs(context, 'customer');
    await page.goto('/browse');
    await expect(page.getByText('Paradise Corner Biryani').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('shop owner', () => {
  test('opens the orders board and the plan page', async ({ context, page }) => {
    await signInAs(context, 'owner');
    await page.goto('/business/orders');
    await expect(page.getByRole('heading', { name: /orders/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.goto('/business/billing');
    await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible();
  });
});

test.describe('shop calls the customer', () => {
  test('a new order shows Call customer and See location', async ({ context, page }) => {
    await signInAs(context, 'owner');
    await page.goto('/business/orders');
    const call = page.getByRole('link', { name: /Call the customer on/ }).first();
    await expect(call).toBeVisible({ timeout: 15_000 });
    await expect(call).toHaveAttribute('href', /^tel:/);
    await expect(page.getByRole('link', { name: 'See location' }).first()).toHaveAttribute('href', /google\.com\/maps/);
  });
});

test.describe('admin', () => {
  test('is kept out of the admin area for a customer', async ({ context, page }) => {
    await signInAs(context, 'customer');
    const response = await page.goto('/admin');
    // Either redirected away, or the page says it is for admins only; never the real overview.
    const blocked = !/\/admin$/.test(page.url()) || (await page.getByText(/admins only/i).count()) > 0;
    expect(blocked, `status ${response?.status()}`).toBe(true);
  });

  test('pauses a shop so customers cannot see it, then restores it', async ({ browser }) => {
    const adminContext = await browser.newContext();
    await signInAs(adminContext, 'admin');
    const admin = await adminContext.newPage();
    await admin.goto('/admin/shops');
    const card = admin.locator('div', { hasText: 'Paradise Corner Biryani' }).filter({ has: admin.getByRole('button', { name: 'Pause' }) }).last();
    await card.getByRole('button', { name: 'Pause' }).click();
    await admin.getByLabel('Reason for pausing').fill('End-to-end test');
    await admin.getByRole('button', { name: 'Pause now' }).click();
    await expect(admin.getByText('Paused', { exact: true }).first()).toBeVisible();

    const customerContext = await browser.newContext();
    await signInAs(customerContext, 'customer');
    const customer = await customerContext.newPage();
    await customer.goto('/browse');
    await customer.waitForLoadState('networkidle');
    await expect(customer.getByText('Paradise Corner Biryani')).toHaveCount(0);

    await admin.getByRole('button', { name: 'Restore' }).first().click();
    await expect(admin.getByText('Paused', { exact: true })).toHaveCount(0);
    await customer.reload();
    await expect(customer.getByText('Paradise Corner Biryani').first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('groceries and everyday fixes', () => {
  const nearShops = { latitude: 17.3855, longitude: 78.488, accuracy: 20 };

  test('a customer browses a grocery shop and places an order', async ({ browser }) => {
    const context = await browser.newContext({ geolocation: nearShops, permissions: ['geolocation'] });
    await signInAs(context, 'customer');
    const page = await context.newPage();
    await page.goto('/browse?mode=items');
    await expect(page.getByText('Shops near you')).toBeVisible({ timeout: 15_000 });
    await page.getByText('Balaji Kirana Store').first().click();
    await page.waitForURL(/\/shop\//);
    await page.getByRole('button', { name: /^add/i }).first().click();
    await page.getByRole('link', { name: /view cart/i }).click();
    await page.waitForURL(/\/cart/);
    // Above the shop's minimum order.
    await page.getByRole('button', { name: /^Add one/ }).first().click();
    await page.getByRole('button', { name: /^Add one/ }).first().click();
    // The cart places the order itself, to the saved address. This shop takes cash on delivery only.
    await page.getByRole('button', { name: /^Place order/ }).click();
    await page.waitForURL(/\/orders\//, { timeout: 20_000 });
    await expect(page.getByText(/Waiting for Balaji Kirana Store/)).toBeVisible();
    await context.close();
  });

  test('with no shops nearby, the customer is told so plainly', async ({ browser }) => {
    const context = await browser.newContext({ geolocation: { latitude: 14.4426, longitude: 79.9865, accuracy: 20 }, permissions: ['geolocation'] });
    const page = await context.newPage();
    await page.goto('/browse');
    await expect(page.getByText('No restaurants near you yet')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('See sample shops')).toHaveCount(0);
    await context.close();
  });

  test('a customer adds an address from the account page', async ({ browser }) => {
    const context = await browser.newContext({ geolocation: nearShops, permissions: ['geolocation'] });
    await signInAs(context, 'customer');
    const page = await context.newPage();
    await page.goto('/account');
    await page.getByRole('button', { name: '+ Add a new address' }).click();
    await page.getByPlaceholder('Name of who will receive').fill('Asha Reddy');
    await page.getByLabel('Mobile number').fill('12345');
    await page.getByPlaceholder('Flat / house no., building, street').fill('22 Lake View Road');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText(/10-digit mobile number/)).toBeVisible();
    await page.getByLabel('Mobile number').fill('+91 98765 43210');
    await page.getByRole('button', { name: 'Save address' }).click();
    await expect(page.getByText('22 Lake View Road')).toBeVisible({ timeout: 10_000 });
    await context.close();
  });

  test('tapping Save several times on a slow connection makes one product', async ({ context, page }) => {
    await signInAs(context, 'owner');
    // Like the server waking up: each product save takes 3 seconds.
    await page.route('**/v1/seller/products', async (route) => {
      if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    await page.goto('/business/products/new');
    await page.getByLabel('Name').fill('Triple Tap Paneer');
    await page.getByLabel('Price (₹)').fill('180');
    await page.getByLabel('Category').selectOption({ index: 1 });
    const save = page.locator('button[type="submit"]');
    await save.click();
    await save.click({ force: true, timeout: 2_000 }).catch(() => undefined);
    await save.click({ force: true, timeout: 2_000 }).catch(() => undefined);
    await page.waitForURL(/\/business\/products$/, { timeout: 20_000 });
    await expect(page.getByText('Triple Tap Paneer')).toHaveCount(1);
  });
});
