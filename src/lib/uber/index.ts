import { hmacHex, safeEqual } from "../security";
import { LiveUberDirect } from "./live";
import { MockUberDirect } from "./mock";
import type { UberDirect } from "./types";

export * from "./types";

export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export function uberLive() {
  return Boolean(process.env.UBER_CUSTOMER_ID && process.env.UBER_CLIENT_ID && process.env.UBER_CLIENT_SECRET);
}

/** Adapter switch: set the three UBER_* env vars and the real API takes over. */
export function getUber(): UberDirect {
  if (uberLive()) {
    return new LiveUberDirect({
      customerId: process.env.UBER_CUSTOMER_ID!,
      clientId: process.env.UBER_CLIENT_ID!,
      clientSecret: process.env.UBER_CLIENT_SECRET!,
    });
  }
  return new MockUberDirect(appUrl());
}

/** Signing key for status webhooks. Mock mode signs its own simulated events with the same scheme. */
export function uberWebhookKey() {
  return process.env.UBER_WEBHOOK_SIGNING_KEY || (uberLive() ? "" : "mock-uber-webhook-signing-key");
}

/**
 * Uber Direct signs webhook bodies with HMAC-SHA256 (hex) using the webhook signing key,
 * sent as `x-uber-signature` (legacy: `x-postmates-signature`).
 */
export function verifyUberSignature(rawBody: string, signature: string | null, key: string) {
  if (!signature || !key) return false;
  return safeEqual(hmacHex(key, rawBody), signature.trim().toLowerCase());
}

export function signUberPayload(rawBody: string, key: string) {
  return hmacHex(key, rawBody);
}
