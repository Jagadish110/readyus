// Each visit starts from where the phone is now; a place saved on an earlier visit is only the fallback.
import { expect, test, type BrowserContext } from '@playwright/test';
// The demo shops are around 17.385, 78.4867. "Saved from an earlier visit" = right next to them.
async function savedNearShops(context: BrowserContext) {
  const saved = { lat: 17.385, lng: 78.4867, label: 'Old area, Test City', radiusKm: 5 };
  await context.addCookies([{ name: 'readyus-loc', value: encodeURIComponent(JSON.stringify(saved)), url: 'http://localhost:3100' }]);
  await context.addInitScript((value) => { try { if (!localStorage.getItem('readyus-location')) localStorage.setItem('readyus-location', value); } catch {} }, JSON.stringify(saved));
}

test('a new visit uses where the phone is now, not the saved area', async ({ browser }) => {
  // The phone is now about 400 km away.
  const context = await browser.newContext({ geolocation: { latitude: 14.4426, longitude: 79.9865, accuracy: 20 }, permissions: ['geolocation'] });
  await savedNearShops(context);
  const page = await context.newPage();
  await page.goto('/browse');
  await expect(page.getByText('Current location').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Paradise Corner Biryani')).toHaveCount(0, { timeout: 15000 });
  // Moving to another page in the same visit does not ask again.
  await page.goto('/search');
  await expect(page.getByText('Finding shops near you')).toHaveCount(0);
  await context.close();
});

test('if location is refused, the saved area is used', async ({ browser }) => {
  const context = await browser.newContext(); // no permission granted: the browser refuses
  await savedNearShops(context);
  const page = await context.newPage();
  await page.goto('/browse');
  await expect(page.getByText('Paradise Corner Biryani').first()).toBeVisible({ timeout: 15000 });
  // ... and says so: these shops are for the place saved earlier, and how to allow location.
  await expect(page.getByText(/We could not read your location, so these are shops near Old area/)).toBeVisible();
  await expect(page.getByText(/Location is blocked for localty\.in/).first()).toBeVisible();
  await context.close();
});

test('near the shops, they show', async ({ browser }) => {
  const context = await browser.newContext({ geolocation: { latitude: 17.3855, longitude: 78.488, accuracy: 20 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  await page.goto('/browse');
  await expect(page.getByText('Paradise Corner Biryani').first()).toBeVisible({ timeout: 15000 });
  await context.close();
});

test('when GPS is too slow indoors, the quicker network position is used', async ({ browser }) => {
  const context = await browser.newContext();
  await savedNearShops(context);
  // A phone that cannot get a GPS fix in time but knows roughly where it is from Wi-Fi, about 400 km away.
  await context.addInitScript(() => {
    const far = { coords: { latitude: 14.4426, longitude: 79.9865, accuracy: 150 }, timestamp: Date.now() };
    const geo = navigator.geolocation;
    Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: 'granted' }) } });
    geo.watchPosition = (_ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      setTimeout(() => fail?.({ code: 3, message: 'Timeout' } as GeolocationPositionError), 50);
      return 1;
    };
    geo.clearWatch = () => {};
    geo.getCurrentPosition = (ok: PositionCallback) => {
      setTimeout(() => ok(far as unknown as GeolocationPosition), 50);
    };
  });
  const page = await context.newPage();
  await page.goto('/browse');
  await expect(page.getByText('Current location').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Paradise Corner Biryani')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByText(/We could not read your location/)).toHaveCount(0);
  await context.close();
});

test('signing out forgets the saved place, so the next account starts from its own location', async ({ browser }) => {
  const context = await browser.newContext();
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'asha@example.test' };
  const jwt = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: user.id, role: 'authenticated', exp: 4102444800 }))}.sig-tok-customerAA`;
  const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { ...user, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
  await context.addCookies([{ name: 'sb-localhost-auth-token', value: 'base64-' + b64url(JSON.stringify(session)), url: 'http://localhost:3100' }]);
  // Saved once, on the first page of the visit only.
  await context.addInitScript((value) => {
    try {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('readyus-location', value);
      }
    } catch {}
  }, JSON.stringify({ lat: 17.385, lng: 78.4867, label: 'Old area, Test City', radiusKm: 5 }));
  const page = await context.newPage();
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/sign-in/);
  expect(await page.evaluate(() => localStorage.getItem('readyus-location'))).toBeNull();
  expect((await context.cookies()).some((c) => c.name === 'readyus-loc')).toBe(false);
  await context.close();
});
