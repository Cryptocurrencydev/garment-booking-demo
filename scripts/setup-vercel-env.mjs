// Pushes app env vars to Vercel production without printing secret values.
// Reads Square sandbox creds from .env.local, creates the Square webhook subscription if missing.
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const local = config({ path: ".env.local", processEnv: {}, quiet: true }).parsed ?? {};
const APP_URL = process.argv[2];
const ADMIN_PASSWORD = process.argv[3];
if (!APP_URL || !ADMIN_PASSWORD) throw new Error("usage: setup-vercel-env.mjs <app-url> <admin-password>");
const hookUrl = `${APP_URL}/api/webhooks/square`;

const sq = (path, init = {}) =>
  fetch("https://connect.squareupsandbox.com" + path, {
    ...init,
    headers: { Authorization: `Bearer ${local.SQUARE_ACCESS_TOKEN}`, "Square-Version": "2025-10-16", "Content-Type": "application/json" },
  }).then((r) => r.json());

const list = await sq("/v2/webhooks/subscriptions");
let sub = (list.subscriptions ?? []).find((s) => s.notification_url === hookUrl);
if (!sub) {
  const r = await sq("/v2/webhooks/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: randomBytes(16).toString("hex"),
      subscription: {
        name: "garment-booking-demo",
        notification_url: hookUrl,
        event_types: ["invoice.payment_made", "invoice.scheduled_charge_failed", "subscription.created", "subscription.updated", "payment.updated"],
        api_version: "2025-10-16",
      },
    }),
  });
  if (r.errors) throw new Error(JSON.stringify(r.errors));
  sub = r.subscription;
  console.log("created Square webhook subscription", sub.id);
} else console.log("Square webhook subscription exists", sub.id);
const got = await sq(`/v2/webhooks/subscriptions/${sub.id}`);
const keyRes = { signature_key: sub.signature_key ?? got.subscription?.signature_key };
if (!keyRes.signature_key) throw new Error("no signature key: " + JSON.stringify(got.errors ?? Object.keys(got.subscription ?? {})));

const vars = {
  SQUARE_ENVIRONMENT: "sandbox",
  SQUARE_APPLICATION_ID: local.SQUARE_APPLICATION_ID,
  SQUARE_ACCESS_TOKEN: local.SQUARE_ACCESS_TOKEN,
  SQUARE_LOCATION_ID: local.SQUARE_LOCATION_ID,
  SQUARE_WEBHOOK_SIGNATURE_KEY: keyRes.signature_key,
  SQUARE_WEBHOOK_URL: hookUrl,
  APP_URL,
  SESSION_SECRET: randomBytes(32).toString("hex"),
  ADMIN_PASSWORD,
};
for (const [k, v] of Object.entries(vars)) {
  spawnSync("vercel", ["env", "rm", k, "production", "--yes"], { stdio: "ignore" });
  const r = spawnSync("vercel", ["env", "add", k, "production"], { input: v, stdio: ["pipe", "ignore", "pipe"] });
  console.log(k, r.status === 0 ? "set" : `FAILED ${r.stderr}`);
}
