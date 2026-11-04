import { ADDRESS, email, expect, fillSquareCard, stubAddress, test } from "./fixtures";

test("home: three big actions, sandbox labels, DC Tech credit", async ({ page, errors }) => {
  void errors;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marlowe & Finch");
  for (const t of ["Schedule a pickup", "Schedule a delivery", "Become a member"]) await expect(page.getByRole("link", { name: new RegExp(t) })).toBeVisible();
  await expect(page.getByTestId("uber-mode")).toContainText(/Uber Direct sandbox/);
  const credit = page.getByRole("link", { name: "DC Tech" });
  await expect(credit).toHaveAttribute("href", "https://dctechltd.com");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe.serial("pickup: quote → pay → dispatch, then one-tap repeat", () => {
  test("first booking with a new card (saved)", async ({ page, errors }, info) => {
    void errors;
    await stubAddress(page);
    await page.goto("/book/pickup");
    await page.getByTestId("address-input").fill("12 Valley");
    await page.getByRole("option", { name: /12 Valley Place/ }).click();
    await expect(page.getByTestId("quote-fee")).toHaveText(/\$\d+\.\d\d/);
    await expect(page.getByTestId("quote-eta")).toContainText("min door to door");
    await page.getByLabel("Apt / unit").fill("2B");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.locator("label:has(input[name=window])").first().click();
    await expect(page.getByTestId("quote-eta")).toContainText("priced for your window");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("button", { name: "Add one Shirt, laundered & pressed" }).click();
    await page.getByRole("button", { name: "Add one Shirt, laundered & pressed" }).click();
    await page.getByRole("button", { name: "Add one Suit, two-piece" }).click();
    await page.getByLabel("Notes for the atelier").fill("Light starch please");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Full name").fill("Avery Playwright");
    await page.getByLabel("Email").fill(email("pickup", info.project.name));
    await page.getByLabel("Mobile").fill("(973) 555-0100");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByTestId("total")).toHaveText(/\$\d+\.\d\d/);
    await fillSquareCard(page);
    await page.getByTestId("pay").click();
    await page.waitForURL(/\/confirmation\/MF-/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Pickup booked" })).toBeVisible();
    await expect(page.getByTestId("track-label")).toBeVisible();
    await expect(page.getByText("Confirmation email (demo outbox preview)")).toBeVisible();
    await page.screenshot({ path: `test-results/shots/${info.project.name}-confirmation.png`, fullPage: true });
  });

  test("returning customer checks out in one tap with the saved card", async ({ page, errors }, info) => {
    void errors;
    // Fresh page, same storage? Playwright isolates contexts per test, so re-create the session by first booking in this context.
    await stubAddress(page);
    await page.goto("/book/delivery");
    await page.getByTestId("address-input").fill("12 Valley");
    await page.getByRole("option", { name: /12 Valley Place/ }).click();
    await expect(page.getByTestId("quote-fee")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("label:has(input[name=window])").first().click();
    await expect(page.getByTestId("quote-eta")).toContainText("priced for your window");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Ticket number (from your receipt)").fill("4821");
    await page.getByRole("button", { name: "Add one Dress" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Full name").fill("Riley Returning");
    await page.getByLabel("Email").fill(email("repeat", info.project.name));
    await page.getByLabel("Mobile").fill("9735550199");
    await page.getByRole("button", { name: "Continue" }).click();
    await fillSquareCard(page);
    await page.getByTestId("pay").click();
    await page.waitForURL(/\/confirmation\/MF-/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Delivery booked" })).toBeVisible();

    // Second order: the card on file is offered and used with one tap.
    await page.goto("/book/pickup");
    await page.getByTestId("address-input").fill("12 Valley");
    await page.getByRole("option", { name: /12 Valley Place/ }).click();
    await expect(page.getByTestId("quote-fee")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.locator("label:has(input[name=window])").nth(1).click();
    await expect(page.getByTestId("quote-eta")).toContainText("priced for your window");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Add one Coat or outerwear" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("Full name")).toHaveValue("Riley Returning");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/•••• 1111 · saved/)).toBeVisible();
    await expect(page.getByTestId("square-card")).toHaveCount(0);
    await expect(page.getByTestId("pay")).toContainText("Visa 1111");
    await page.getByTestId("pay").click();
    await page.waitForURL(/\/confirmation\/MF-/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Pickup booked" })).toBeVisible();
  });
});

test("declined card shows a friendly error and lets the customer retry", async ({ page, errors }, info) => {
  void errors;
  await stubAddress(page);
  await page.goto("/book/pickup");
  await page.getByTestId("address-input").fill("12 Valley");
  await page.getByRole("option", { name: /12 Valley Place/ }).click();
  await expect(page.getByTestId("quote-fee")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("label:has(input[name=window])").first().click();
  await expect(page.getByTestId("quote-eta")).toContainText("priced for your window");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Add one Knitwear" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Full name").fill("Dee Clined");
  await page.getByLabel("Email").fill(email("declined", info.project.name));
  await page.getByLabel("Mobile").fill("9735550123");
  await page.getByRole("button", { name: "Continue" }).click();
  // Square sandbox: CVV 911 → CVV_FAILURE decline.
  const frame = page.frameLocator("iframe.sq-card-component").first();
  await frame.locator("#cardNumber").fill("4111 1111 1111 1111");
  await frame.locator("#expirationDate").fill("12/30");
  await frame.locator("#cvv").fill("911");
  await frame.locator("#postalCode").fill("07042");
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("pay-error")).toContainText("declined");
  await expect(page).toHaveURL(/\/book\/pickup/);
});

test("address outside the courier area is explained before payment", async ({ page, errors }) => {
  void errors;
  await page.route("**/api/address?*", (r) => r.fulfill({ json: { results: [{ ...ADDRESS, line1: "1 Nassau St", city: "Princeton", zip: "08542", lat: 40.3497, lon: -74.6593, label: "1 Nassau St, Princeton, NJ 08542" }] } }));
  await page.goto("/book/pickup");
  await page.getByTestId("address-input").fill("1 Nassau");
  await page.getByRole("option", { name: /Nassau/ }).click();
  await expect(page.getByText(/outside our courier area/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
});

test("membership: subscribe, update card, cancel", async ({ page, errors }, info) => {
  void errors;
  await page.goto("/membership");
  await expect(page.getByRole("heading", { name: "The Marlowe Membership" })).toBeVisible();
  await page.getByLabel("Full name").fill("Morgan Member");
  await page.getByLabel("Email").fill(email("member", info.project.name));
  await page.getByLabel("Mobile").fill("9735550111");
  await fillSquareCard(page);
  await page.getByTestId("subscribe-btn").click();
  await expect(page.getByTestId("manage")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("member-status")).toHaveText(/Active|Starting/);
  await expect(page.getByTestId("member-card")).toContainText("1111");

  await page.getByTestId("update-card").click();
  await fillSquareCard(page, "4111 1111 1111 1111");
  await page.waitForTimeout(300);
  await page.getByTestId("save-card").click();
  await expect(page.getByTestId("member-notice")).toContainText("Visa •••• 1111");

  await page.getByTestId("cancel").click();
  await page.getByTestId("confirm-cancel").click();
  // Square ends it at period end (status "Ending"), or immediately if the first invoice hasn't billed yet.
  await expect(page.getByTestId("member-notice")).toContainText(/perks continue until|won't be charged again/);
  await expect(page.getByTestId("member-status").or(page.getByTestId("subscribe"))).toBeVisible();
  await expect(page.getByTestId("cancel")).toHaveCount(0);
});

test("admin: password-protected dashboard lists requests, members, payments, notifications", async ({ page, errors }) => {
  void errors;
  await page.goto("/admin");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect password.")).toBeVisible();
  await page.getByLabel("Password").fill(process.env.E2E_ADMIN_PASSWORD ?? "demo-admin");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today at the atelier" })).toBeVisible();
  await expect(page.getByTestId("admin-requests").locator("li").first()).toBeVisible();
  await page.getByRole("link", { name: "Members" }).click();
  await expect(page.getByTestId("admin-members").locator("li").first()).toBeVisible();
  await page.getByRole("link", { name: "Payments" }).click();
  await expect(page.getByTestId("admin-payments")).toBeVisible();
  await page.getByRole("link", { name: "Notifications" }).click();
  await expect(page.getByTestId("admin-outbox").locator("li").first()).toBeVisible();
});

test("webhook endpoints reject unsigned requests", async ({ request }) => {
  const u = await request.post("/api/webhooks/uber", { data: { id: "x", delivery_id: "y", status: "delivered", kind: "event.delivery_status" } });
  expect(u.status()).toBe(401);
  const s = await request.post("/api/webhooks/square", { data: { event_id: "x", type: "invoice.payment_made" } });
  expect(s.status()).toBe(401);
});

test("invalid US phone (432-098-2220, the production failure) is caught on the form with a clear message", async ({ page, errors }) => {
  void errors;
  await page.goto("/membership");
  await page.getByLabel("Full name").fill("Kay Kay");
  await page.getByLabel("Email").fill("marlowe.finch.demo+phone@gmail.com");
  await page.getByLabel("Mobile").fill("432-098-2220");
  await expect(page.getByTestId("phone-error")).toContainText("valid US mobile number");
  await expect(page.getByTestId("subscribe-btn")).toBeDisabled();
  await page.getByLabel("Mobile").fill("(973) 555-0142");
  await expect(page.getByTestId("phone-error")).toBeEmpty();
});
