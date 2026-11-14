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
  await context.close();
});

test('near the shops, they show', async ({ browser }) => {
  const context = await browser.newContext({ geolocation: { latitude: 17.3855, longitude: 78.488, accuracy: 20 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  await page.goto('/browse');
  await expect(page.getByText('Paradise Corner Biryani').first()).toBeVisible({ timeout: 15000 });
  await context.close();
});
