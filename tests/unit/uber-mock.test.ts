import { describe, expect, it } from "vitest";
import { STORE } from "@/lib/config";
import { MOCK_PRICING, MOCK_TIMELINE, MockUberDirect, mockFee } from "@/lib/uber/mock";
import { getUber } from "@/lib/uber";
import { FAR, NEAR } from "./helpers";

const store = { ...STORE.address };

describe("Uber Direct mock adapter", () => {
  it("is selected when UBER_* credentials are absent", () => {
    expect(getUber().mode).toBe("uber-mock");
  });

  it("prices by distance: base + per-mile, never below minimum", () => {
    const near = mockFee({ pickup: NEAR, dropoff: store });
    const same = mockFee({ pickup: store, dropoff: store });
    const farther = mockFee({ pickup: { ...NEAR, lat: NEAR.lat + 0.05 }, dropoff: store });
    expect(same.cents).toBe(MOCK_PRICING.minCents);
    expect(near.cents).toBeGreaterThan(MOCK_PRICING.baseCents);
    expect(farther.cents).toBeGreaterThan(near.cents);
    expect(near.miles).toBeGreaterThan(2);
    expect(near.miles).toBeLessThan(5);
  });

  it("adds the evening surcharge for windows after 5 pm store time", () => {
    const morning = mockFee({ pickup: NEAR, dropoff: store, pickupReadyAt: new Date("2026-11-05T14:00:00Z") }); // 9 am ET
    const evening = mockFee({ pickup: NEAR, dropoff: store, pickupReadyAt: new Date("2026-11-05T22:00:00Z") }); // 5 pm ET
    expect(evening.cents - morning.cents).toBe(MOCK_PRICING.eveningSurchargeCents);
  });

  it("returns a quote with fee, ETA and 15-minute expiry", async () => {
    const q = await new MockUberDirect("http://x").createQuote({ pickup: NEAR, dropoff: store });
    expect(q.providerQuoteId).toMatch(/^dqt_mock_/);
    expect(q.etaMinutes).toBeGreaterThan(10);
    expect(q.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
  });

  it("rejects addresses outside the courier radius", async () => {
    await expect(new MockUberDirect("http://x").createQuote({ pickup: FAR, dropoff: store })).rejects.toMatchObject({ code: "address_undeliverable" });
  });

  it("creates deterministic delivery ids from the idempotency key", async () => {
    const u = new MockUberDirect("http://app");
    const input = { pickup: NEAR, dropoff: store, quoteId: "dqt_mock_x", pickupStop: { name: "a", phone: "1", address: NEAR }, dropoffStop: { name: "b", phone: "2", address: store }, externalId: "MF-ABC", manifest: [], idempotencyKey: "k1" };
    const a = await u.createDelivery(input);
    const b = await u.createDelivery(input);
    expect(a.id).toBe(b.id);
    expect(a.trackingUrl).toBe("http://app/track/MF-ABC");
  });

  it("status timeline goes pending → pickup → pickup_complete → dropoff → delivered", () => {
    expect(MOCK_TIMELINE.map((s) => s.status)).toEqual(["pending", "pickup", "pickup_complete", "dropoff", "delivered"]);
  });
});
