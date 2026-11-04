import { chromium, devices } from "@playwright/test";
const BASE = "https://garment-booking-demo.vercel.app";
const flow = process.argv[2] ?? "pickup";
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, timezoneId: "America/New_York" });
const p = await ctx.newPage();
const log = (...a) => console.log(`[${flow}]`, ...a);
p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && log("console", m.type(), m.text().slice(0, 300)));
p.on("pageerror", (e) => log("pageerror", e.message));
p.on("requestfailed", (r) => log("reqfailed", r.url().slice(0, 120), r.failure()?.errorText));
p.on("request", (r) => /square/.test(r.url()) && r.resourceType() === "script" && log("script", r.url()));
p.on("response", async (r) => {
  const u = r.url();
  if (/\/api\/(quote|checkout|membership|address)/.test(u) || (/squareup|squarecdn/.test(u) && r.request().method() === "POST")) {
    let body = ""; try { body = (await r.text()).slice(0, 400); } catch {}
    log("resp", r.status(), r.request().method(), u.slice(0, 110), "x-vercel-id=" + (r.headers()["x-vercel-id"] ?? ""), body);
  }
});
async function card() {
  const f = p.frameLocator("iframe.sq-card-component").first();
  await f.locator("#cardNumber").fill("4111 1111 1111 1111");
  await f.locator("#expirationDate").fill("12/30");
  await f.locator("#cvv").fill("111");
  await f.locator("#postalCode").fill("07042");
}
try {
  if (flow === "membership") {
    await p.goto(BASE + "/membership");
    await p.getByLabel("Full name").fill("Repro Member");
    await p.getByLabel("Email").fill(`marlowe.finch.demo+repro-${Date.now()}@gmail.com`);
    await p.getByLabel("Mobile").fill(process.env.PHONE ?? "9735550111");
    await card();
    await p.getByTestId("subscribe-btn").click();
    await p.waitForTimeout(12000);
  } else {
    await p.goto(BASE + "/book/" + flow);
    await p.getByTestId("address-input").pressSequentially("50 church st, montclair, nj 07042", { delay: 30 });
    const opt = p.getByRole("option").first();
    await opt.waitFor({ timeout: 15000 }).catch(() => {});
    log("options", await p.getByRole("option").allInnerTexts());
    await opt.click();
    await p.getByTestId("quote-fee").waitFor({ timeout: 15000 });
    log("quote", await p.getByTestId("quote").innerText());
    await p.getByRole("button", { name: "Continue" }).click();
    await p.locator("label:has(input[name=window])").first().click();
    await p.getByText("priced for your window").waitFor();
    await p.getByRole("button", { name: "Continue" }).click();
    if (flow === "delivery") await p.getByLabel("Ticket number (from your receipt)").fill("4821");
    await p.getByRole("button", { name: /Add one Shirt/ }).click();
    await p.getByRole("button", { name: "Continue" }).click();
    await p.getByLabel("Full name").fill("Repro Phone");
    await p.getByLabel("Email").fill(`marlowe.finch.demo+repro-${Date.now()}@gmail.com`);
    await p.getByLabel("Mobile").fill(process.env.PHONE ?? "(973) 555-0100");
    await p.getByRole("button", { name: "Continue" }).click();
    await card();
    await p.getByTestId("pay").click();
    await p.waitForTimeout(12000);
  }
  log("url", p.url());
  for (const a of await p.getByRole("alert").allInnerTexts()) if (a.trim()) log("UI alert:", a.trim());
  await p.screenshot({ path: `test-results/repro-${flow}.png`, fullPage: true });
} catch (e) { log("SCRIPT ERROR", e.message.split("\n")[0]); await p.screenshot({ path: `test-results/repro-${flow}.png`, fullPage: true }); }
await b.close();
