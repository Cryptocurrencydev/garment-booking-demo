import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleUberWebhook } from "@/lib/bookings";
import { handleSquareWebhook, squareWebhookUrl } from "@/lib/memberships";
import { idemKey } from "@/lib/security";
import { signSquarePayload, verifySquareSignature } from "@/lib/square";
import { signUberPayload, uberWebhookKey, verifyUberSignature } from "@/lib/uber";
import { closeDb, resetDb } from "./helpers";
import { q } from "@/lib/db";

beforeAll(resetDb);
afterAll(closeDb);

describe("Uber webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", kind: "event.delivery_status", delivery_id: "del_x", status: "pickup" });
  it("accepts a valid HMAC-SHA256 hex signature", () => {
    expect(verifyUberSignature(body, signUberPayload(body, "k"), "k")).toBe(true);
    expect(verifyUberSignature(body, signUberPayload(body, "k").toUpperCase(), "k")).toBe(true);
  });
  it("rejects tampered body, wrong key, missing signature", () => {
    const sig = signUberPayload(body, "k");
    expect(verifyUberSignature(body.replace("pickup", "delivered"), sig, "k")).toBe(false);
    expect(verifyUberSignature(body, sig, "other")).toBe(false);
    expect(verifyUberSignature(body, null, "k")).toBe(false);
    expect(verifyUberSignature(body, sig, "")).toBe(false);
  });
  it("handler returns 401 on a bad signature and stores nothing", async () => {
    const r = await handleUberWebhook(body, "deadbeef");
    expect(r.status).toBe(401);
    expect(await q("select 1 from webhook_events")).toHaveLength(0);
  });
  it("handler de-duplicates the same event id", async () => {
    const sig = signUberPayload(body, uberWebhookKey());
    const a = await handleUberWebhook(body, sig);
    const b = await handleUberWebhook(body, sig);
    expect(a).toMatchObject({ ok: true, duplicate: false });
    expect(b).toMatchObject({ ok: true, duplicate: true });
    expect(await q("select 1 from webhook_events where provider='uber'")).toHaveLength(1);
  });
});

describe("Square webhook signatures", () => {
  const body = JSON.stringify({ event_id: "sq_evt_1", type: "payment.updated", data: { object: { payment: { id: "nope", status: "COMPLETED" } } } });
  const key = "test-square-signature-key";
  it("signs URL + body (base64) and verifies", () => {
    const sig = signSquarePayload(body, squareWebhookUrl(), key);
    expect(verifySquareSignature(body, sig, squareWebhookUrl(), key)).toBe(true);
  });
  it("rejects a different notification URL, tampered body or key", () => {
    const sig = signSquarePayload(body, squareWebhookUrl(), key);
    expect(verifySquareSignature(body, sig, "https://evil.example/api/webhooks/square", key)).toBe(false);
    expect(verifySquareSignature(body + " ", sig, squareWebhookUrl(), key)).toBe(false);
    expect(verifySquareSignature(body, sig, squareWebhookUrl(), "x")).toBe(false);
  });
  it("handler: 401 on bad signature, 200 once then duplicate", async () => {
    expect((await handleSquareWebhook(body, "bad")).status).toBe(401);
    const sig = signSquarePayload(body, squareWebhookUrl(), key);
    expect(await handleSquareWebhook(body, sig)).toMatchObject({ ok: true, duplicate: false });
    expect(await handleSquareWebhook(body, sig)).toMatchObject({ ok: true, duplicate: true });
  });
});

describe("idempotency keys", () => {
  it("are stable per attempt+purpose, distinct across purposes, and Square-length", () => {
    const base = "8f0f6c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
    expect(idemKey(base, "payment")).toBe(idemKey(base, "payment"));
    expect(idemKey(base, "payment")).not.toBe(idemKey(base, "card"));
    expect(idemKey(base, "payment").length).toBeLessThanOrEqual(45);
  });
});
