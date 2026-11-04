import { test as base, expect, type Page } from "@playwright/test";

/** Every test fails if the page logs a console error or throws. */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      // Square's own sandbox iframe (cross-origin, not our code) logs one CSP notice on load under mobile emulation.
      const fromSquare = /squarecdn\.com/.test(m.location().url) && m.text().startsWith("Executing inline event handler violates");
      if (fromSquare) return;
      errors.push(`console: ${m.text()} @ ${m.location().url}`);
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await use(errors);
    expect(errors, "console errors").toEqual([]);
  },
});
export { expect };

export const ADDRESS = {
  line1: "12 Valley Place",
  city: "Montclair",
  state: "NJ",
  zip: "07043",
  lat: 40.8474202,
  lon: -74.206634,
  exact: true,
  label: "12 Valley Place, Montclair, NJ 07043",
};

/** Deterministic autocomplete in CI (the live route proxies OpenStreetMap Photon). */
export async function stubAddress(page: Page) {
  if (process.env.E2E_LIVE_ADDRESS) return;
  await page.route("**/api/address?*", (r) => r.fulfill({ json: { results: [ADDRESS] } }));
}

export async function fillSquareCard(page: Page, card = "4111 1111 1111 1111") {
  const frame = page.frameLocator("iframe.sq-card-component").first();
  await frame.locator("#cardNumber").fill(card);
  await frame.locator("#expirationDate").fill("12/30");
  await frame.locator("#cvv").fill("111");
  await frame.locator("#postalCode").fill("07042");
}

export function email(tag: string, project: string) {
  return `e2e+${tag}-${project}-${Date.now()}@example.com`;
}
