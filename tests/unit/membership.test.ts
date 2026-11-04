import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkout, createQuote, isActiveMember } from "@/lib/bookings";
import { MEMBERSHIP } from "@/lib/config";
import { one, q } from "@/lib/db";
import { cancelMembership, handleSquareWebhook, squareWebhookUrl, subscribe, updateMembershipCard } from "@/lib/memberships";
import { retrieveSubscription, signSquarePayload } from "@/lib/square";
import { availableWindows } from "@/lib/time";
import { NEAR, closeDb, resetDb, uniqueEmail } from "./helpers";

const KEY = "test-square-signature-key";
const email = uniqueEmail("member");
let subId = "";
let customerId = "";

function signed(ev: unknown) {
  const raw = JSON.stringify(ev);
  return { raw, sig: signSquarePayload(raw, squareWebhookUrl(), KEY) };
}

beforeAll(resetDb);
afterAll(closeDb);

describe("memberships (Square Subscriptions sandbox)", () => {
  it("creates the catalog plan once and subscribes with a card on file", async () => {
    const r = await subscribe({ contact: { name: "Morgan Member", email, phone: "9735550111" }, token: "cnon:card-nonce-ok", postalCode: "07042", idempotencyKey: randomUUID() });
    subId = r.membership.square_subscription_id;
    customerId = r.customer.id;
    expect(["active", "pending"]).toContain(r.membership.status);
    const sub = await retrieveSubscription(subId);
    expect(["ACTIVE", "PENDING"]).toContain(sub.status);
    expect(sub.card_id).toMatch(/^ccof:/);
    const plan = await one<{ value: { variationId: string } }>("select value from settings where key='square_membership_plan'");
    expect(sub.plan_variation_id).toBe(plan!.value.variationId);
    expect(await isActiveMember(customerId)).toBe(true);
  });

  it("stays ACTIVE in Square and the first monthly invoice is created", async () => {
    let sub = await retrieveSubscription(subId);
    for (let i = 0; i < 12 && !(sub.invoice_ids?.length && sub.charged_through_date); i++) {
      await new Promise((r) => setTimeout(r, 2500));
      sub = await retrieveSubscription(subId);
    }
    expect(sub.status).toBe("ACTIVE");
    expect(sub.invoice_ids?.length).toBeGreaterThanOrEqual(1);
    expect(sub.charged_through_date).toBeTruthy();
  });

  it("refuses a second concurrent membership for the same email", async () => {
    await expect(subscribe({ contact: { name: "Morgan Member", email, phone: "9735550111" }, token: "cnon:card-nonce-ok", idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "already_member" });
  });

  it("members get free Uber courier and 15% off at checkout", async () => {
    const w = availableWindows()[0];
    const qt = await createQuote("pickup", NEAR, w.start);
    const r = await checkout(
      { kind: "pickup", quoteId: qt.quoteId, address: NEAR, windowStart: w.start, items: [{ id: "suit", qty: 2 }], contact: { name: "Morgan Member", email, phone: "9735550111" }, payment: { useSavedCard: true }, idempotencyKey: randomUUID() },
      customerId,
    );
    expect(r.booking.delivery_fee_waived).toBe(true);
    expect(r.booking.discount_cents).toBe(Math.round((4400 * MEMBERSHIP.discountPct) / 100));
    expect(r.booking.total_cents).toBe(4400 - r.booking.discount_cents);
  });

  it("invoice.payment_made webhook records the paid invoice exactly once", async () => {
    const ev = { event_id: `evt-paid-${subId}`, type: "invoice.payment_made", data: { type: "invoice", object: { invoice: { id: "inv_test_1", subscription_id: subId, status: "PAID", payment_requests: [{ computed_amount_money: { amount: MEMBERSHIP.priceCents } }] } } } };
    const { raw, sig } = signed(ev);
    expect((await handleSquareWebhook(raw, sig)).status).toBe(200);
    expect(await handleSquareWebhook(raw, sig)).toMatchObject({ duplicate: true });
    const pays = await q<{ status: string; amount_cents: number }>("select status, amount_cents from payments where square_invoice_id='inv_test_1'");
    expect(pays).toEqual([{ status: "PAID", amount_cents: MEMBERSHIP.priceCents }]);
  });

  it("invoice.scheduled_charge_failed marks the member past_due and notifies both sides", async () => {
    const ev = { event_id: `evt-failed-${subId}`, type: "invoice.scheduled_charge_failed", data: { type: "invoice", object: { invoice: { id: "inv_test_2", subscription_id: subId, status: "UNPAID" } } } };
    const { raw, sig } = signed(ev);
    expect((await handleSquareWebhook(raw, sig)).status).toBe(200);
    const m = await one<{ id: string; status: string }>("select id, status from memberships where square_subscription_id=$1", [subId]);
    expect(m!.status).toBe("past_due");
    const n = await q<{ audience: string; subject: string }>("select audience, subject from notifications where membership_id=$1 and (subject ilike '%fail%' or subject ilike '%go through%')", [m!.id]);
    expect(n.map((x) => x.audience).sort()).toEqual(["customer", "owner"]);
    // A subscription.updated ACTIVE event must not clear past_due before a paid invoice arrives.
    const up = signed({ event_id: `evt-upd-${subId}`, type: "subscription.updated", data: { object: { subscription: { id: subId, status: "ACTIVE" } } } });
    await handleSquareWebhook(up.raw, up.sig);
    expect((await one<{ status: string }>("select status from memberships where id=$1", [m!.id]))!.status).toBe("past_due");
  });

  it("updating the card swaps the subscription's card on file", async () => {
    const card = await updateMembershipCard(customerId, "cnon:card-nonce-ok", randomUUID(), "07042");
    const sub = await retrieveSubscription(subId);
    expect(sub.card_id).toBe(card.id);
  });

  it("a later paid invoice restores active", async () => {
    const { raw, sig } = signed({ event_id: `evt-paid2-${subId}`, type: "invoice.payment_made", data: { object: { invoice: { id: "inv_test_3", subscription_id: subId, status: "PAID" } } } });
    await handleSquareWebhook(raw, sig);
    expect((await one<{ status: string }>("select status from memberships where square_subscription_id=$1", [subId]))!.status).toBe("active");
  });

  it("cancel schedules the end of the billing period in Square", async () => {
    const m = await cancelMembership(customerId);
    expect(m.cancel_effective).toBeTruthy();
    const sub = await retrieveSubscription(subId);
    expect(sub.canceled_date).toBeTruthy();
  });

  it("a declined card cannot start a membership", async () => {
    await expect(subscribe({ contact: { name: "Dee Clined", email: uniqueEmail("declined"), phone: "9735550122" }, token: "cnon:card-nonce-declined", idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "payment_failed" });
  });
});
