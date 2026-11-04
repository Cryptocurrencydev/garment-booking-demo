import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contactSchema } from "@/lib/api";
import { checkout, createQuote } from "@/lib/bookings";
import { findOrCreateCustomer, sq } from "@/lib/square";
import { isValidUsPhone, normalizeUsPhone } from "@/lib/phone";
import { availableWindows } from "@/lib/time";
import { NEAR, closeDb, resetDb, uniqueEmail } from "./helpers";

beforeAll(resetDb);
afterAll(closeDb);

describe("US phone validation (matches Square's NANP rules)", () => {
  it.each([
    ["(973) 555-0142", "+19735550142"],
    ["973.555.0142", "+19735550142"],
    ["+1 973 555 0142", "+19735550142"],
    ["19735550142", "+19735550142"],
  ])("accepts %s", (input, out) => expect(normalizeUsPhone(input)).toBe(out));

  it.each(["432-098-2220", "123-456-7890", "973-155-0142", "555-1234", "", "97355501421"])("rejects %s", (input) => expect(isValidUsPhone(input)).toBe(false));

  it("API contact schema rejects the number that broke production", () => {
    const r = contactSchema.safeParse({ name: "kkk", email: "a@b.co", phone: "4320982220" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/valid US mobile/);
  });
});

describe("regression: Square rejecting a phone never blocks checkout", () => {
  it("Square itself rejects 432-098-2220 (root cause)", async () => {
    const err = await sq("/v2/customers", { body: { idempotency_key: randomUUID(), given_name: "Probe", phone_number: "+14320982220" } }).catch((e) => e);
    expect(err.code).toBe("INVALID_PHONE_NUMBER");
  });

  it("customer creation falls back to no phone instead of failing", async () => {
    const id = await findOrCreateCustomer({ email: uniqueEmail("badphone"), name: "Bad Phone", phone: "+14320982220", idempotencyBase: randomUUID() });
    expect(id).toBeTruthy();
  });

  it("full checkout with that phone (bypassing the form) still pays and dispatches", async () => {
    const w = availableWindows()[0];
    const qt = await createQuote("pickup", NEAR, w.start);
    const r = await checkout(
      { kind: "pickup", quoteId: qt.quoteId, address: NEAR, windowStart: w.start, items: [{ id: "shirt", qty: 1 }], contact: { name: "kkk", email: uniqueEmail("kkk"), phone: "4320982220" }, payment: { token: "cnon:card-nonce-ok", saveCard: true }, idempotencyKey: randomUUID() },
      null,
    );
    expect(r.booking.status).toBe("dispatched");
  });
});
