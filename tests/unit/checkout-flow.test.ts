import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { advanceMockDeliveries, checkout, createQuote, handleUberWebhook, type CheckoutInput } from "@/lib/bookings";
import { one, q } from "@/lib/db";
import { sq } from "@/lib/square";
import { availableWindows } from "@/lib/time";
import { signUberPayload, uberWebhookKey } from "@/lib/uber";
import { NEAR, closeDb, resetDb, uniqueEmail } from "./helpers";

// Live Square sandbox + mock Uber Direct + local Postgres.
const email = uniqueEmail("checkout");
let customerId = "";
let firstRef = "";
let firstKey = "";

function input(quoteId: string, windowStart: string, over: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    kind: "pickup",
    quoteId,
    address: NEAR,
    unit: "2B",
    instructions: "Doorman",
    windowStart,
    items: [{ id: "shirt", qty: 5 }, { id: "suit", qty: 1 }],
    notes: "Light starch",
    contact: { name: "Avery Test", email, phone: "(973) 555-0100" },
    payment: { token: "cnon:card-nonce-ok", saveCard: true, postalCode: "07042" },
    idempotencyKey: randomUUID(),
    ...over,
  };
}

beforeAll(resetDb);
afterAll(closeDb);

describe("quote → pay → dispatch (Square sandbox + Uber mock)", () => {
  const w = availableWindows()[0];

  it("quotes the exact address for the chosen window", async () => {
    const qt = await createQuote("pickup", NEAR, w.start);
    expect(qt.mode).toBe("uber-mock");
    expect(qt.feeCents).toBeGreaterThan(600);
    const row = await one<{ window_start: Date }>("select window_start from quotes where id=$1", [qt.quoteId]);
    expect(row!.window_start.toISOString()).toBe(w.start);
  });

  it("pays with a new card (saved on file), then dispatches a courier", async () => {
    const qt = await createQuote("pickup", NEAR, w.start);
    const inp = input(qt.quoteId, w.start);
    firstKey = inp.idempotencyKey;
    const r = await checkout(inp, null);
    firstRef = r.booking.ref;
    customerId = r.booking.customer_id;
    expect(r.booking.status).toBe("dispatched");
    expect(r.booking.total_cents).toBe(5 * 450 + 2200 + qt.feeCents);
    expect(r.booking.square_payment_id).toBeTruthy();
    expect(r.booking.uber_delivery_id).toMatch(/^del_mock_/);
    expect(r.booking.uber_tracking_url).toContain(`/track/${firstRef}`);

    // Verify against Square itself: amount + customer + card on file.
    const p = await sq<{ payment: { status: string; amount_money: { amount: number }; customer_id: string; reference_id: string } }>(`/v2/payments/${r.booking.square_payment_id}`);
    expect(p.payment.status).toBe("COMPLETED");
    expect(p.payment.amount_money.amount).toBe(r.booking.total_cents);
    expect(p.payment.reference_id).toBe(firstRef);
    const c = await one<{ square_card_id: string; card_last4: string }>("select square_card_id, card_last4 from customers where id=$1", [customerId]);
    expect(c!.square_card_id).toMatch(/^ccof:/);
    expect(c!.card_last4).toHaveLength(4);

    const notes = await q<{ audience: string; channel: string }>("select audience, channel from notifications where booking_id=$1", [r.booking.id]);
    expect(notes.filter((n) => n.audience === "customer" && n.channel === "email")).toHaveLength(1);
    expect(notes.filter((n) => n.audience === "owner" && n.channel === "email")).toHaveLength(1);
  });

  it("replaying the same idempotency key returns the same booking and does not charge twice", async () => {
    const b = await one<{ quote_id: string }>("select quote_id from bookings where ref=$1", [firstRef]);
    const again = await checkout({ ...input(b!.quote_id, w.start), idempotencyKey: firstKey }, null);
    expect(again.replayed).toBe(true);
    expect(again.booking.ref).toBe(firstRef);
    expect(await q("select 1 from payments where booking_id=(select id from bookings where ref=$1)", [firstRef])).toHaveLength(1);
    expect(await q("select 1 from bookings")).toHaveLength(1);
  });

  it("courier status progresses via signed webhooks to delivered; duplicates and regressions are ignored", async () => {
    await q("update bookings set dispatched_at = now() - interval '10 minutes' where ref=$1", [firstRef]);
    await advanceMockDeliveries(firstRef);
    const b = await one<{ id: string; uber_status: string; status: string; courier: { name: string }; uber_delivery_id: string }>("select * from bookings where ref=$1", [firstRef]);
    expect(b!.uber_status).toBe("delivered");
    expect(b!.status).toBe("delivered");
    expect(b!.courier.name).toBeTruthy();
    const evs = await q<{ status: string }>("select status from delivery_events where booking_id=$1 order by id", [b!.id]);
    expect(evs.map((e) => e.status)).toEqual(["pending", "pickup", "pickup_complete", "dropoff", "delivered"]);

    // Re-running the simulator is a no-op (same event ids).
    await advanceMockDeliveries(firstRef);
    expect(await q("select 1 from delivery_events where booking_id=$1", [b!.id])).toHaveLength(5);

    // A late "pickup" event must not move a delivered order backwards.
    const late = JSON.stringify({ id: "evt_late_1", kind: "event.delivery_status", delivery_id: b!.uber_delivery_id, status: "pickup" });
    expect((await handleUberWebhook(late, signUberPayload(late, uberWebhookKey()))).status).toBe(200);
    expect((await one<{ uber_status: string }>("select uber_status from bookings where id=$1", [b!.id]))!.uber_status).toBe("delivered");
  });

  it("canceled webhook marks the booking and alerts the owner", async () => {
    const qt = await createQuote("delivery", NEAR, w.start);
    const r = await checkout(input(qt.quoteId, w.start, { kind: "delivery", ticketNumber: "4821", payment: { useSavedCard: true } }), customerId);
    expect(r.booking.status).toBe("dispatched");
    const body = JSON.stringify({ id: `evt_cancel_${r.booking.ref}`, kind: "event.delivery_status", delivery_id: r.booking.uber_delivery_id, status: "canceled" });
    await handleUberWebhook(body, signUberPayload(body, uberWebhookKey()));
    const b = await one<{ status: string }>("select status from bookings where id=$1", [r.booking.id]);
    expect(b!.status).toBe("canceled");
    expect(await q("select 1 from notifications where booking_id=$1 and audience='owner' and subject like 'Uber canceled%'", [r.booking.id])).toHaveLength(1);
  });

  it("returning customer checks out in one tap with the card on file", async () => {
    const qt = await createQuote("pickup", NEAR, w.start);
    const r = await checkout(input(qt.quoteId, w.start, { payment: { useSavedCard: true } }), customerId);
    expect(r.booking.status).toBe("dispatched");
    const p = await sq<{ payment: { source_type: string; card_details: { card: { fingerprint?: string } } } }>(`/v2/payments/${r.booking.square_payment_id}`);
    expect(p.payment.source_type).toBe("CARD");
  });

  it("saved-card checkout without the remembered-device session is refused", async () => {
    const qt = await createQuote("pickup", NEAR, w.start);
    await expect(checkout(input(qt.quoteId, w.start, { payment: { useSavedCard: true } }), null)).rejects.toMatchObject({ code: "no_saved_card" });
  });

  it("a declined card fails cleanly, records payment_failed and dispatches nothing", async () => {
    const qt = await createQuote("pickup", NEAR, w.start);
    const inp = input(qt.quoteId, w.start, { payment: { token: "cnon:card-nonce-declined", saveCard: false } });
    await expect(checkout(inp, null)).rejects.toMatchObject({ code: "payment_failed", status: 402 });
    const b = await one<{ status: string; uber_delivery_id: string | null }>("select status, uber_delivery_id from bookings where idempotency_key=$1", [inp.idempotencyKey]);
    expect(b).toMatchObject({ status: "payment_failed", uber_delivery_id: null });
  });

  it("an expired quote is re-priced; a higher fee requires explicit acceptance", async () => {
    const qt = await createQuote("pickup", NEAR, w.start);
    await q("update quotes set expires_at = now() - interval '1 minute', fee_cents = 100 where id=$1", [qt.quoteId]);
    const inp = input(qt.quoteId, w.start);
    const err = await checkout(inp, null).catch((e) => e);
    expect(err.code).toBe("fee_changed");
    expect(err.extra.feeCents).toBeGreaterThan(100);
    const ok = await checkout({ ...inp, quoteId: err.extra.quoteId, acceptFee: err.extra.feeCents, idempotencyKey: randomUUID() }, null);
    expect(ok.booking.delivery_fee_cents).toBe(err.extra.feeCents);
  });

  it("rejects windows that are not offered", async () => {
    const qt = await createQuote("pickup", NEAR, w.start);
    await expect(checkout(input(qt.quoteId, "2020-01-01T15:00:00.000Z"), null)).rejects.toMatchObject({ code: "bad_window" });
  });
});
