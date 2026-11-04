import { CURRENCY, MEMBERSHIP, STORE } from "./config";
import { getSetting, setSetting } from "./db";
import { hmacBase64, idemKey, safeEqual } from "./security";

/** Thin Square REST client (sandbox by default). No SDK: every call is explicit and carries an idempotency key. */
const SQUARE_VERSION = "2025-10-16";

export function squareEnv() {
  return process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
}

function baseUrl() {
  return squareEnv() === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
}

export function squareConfigured() {
  return Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID && process.env.SQUARE_APPLICATION_ID);
}

export function locationId() {
  const id = process.env.SQUARE_LOCATION_ID;
  if (!id) throw new Error("SQUARE_LOCATION_ID is not set");
  return id;
}

export class SquareError extends Error {
  constructor(
    message: string,
    public status: number,
    public errors: { code: string; detail?: string; category?: string; field?: string }[],
  ) {
    super(message);
  }
  get code() {
    return this.errors[0]?.code ?? "UNKNOWN";
  }
  /** Customer-safe message. */
  get friendly() {
    const c = this.code;
    if (["GENERIC_DECLINE", "CARD_DECLINED", "CVV_FAILURE", "INSUFFICIENT_FUNDS", "CARD_DECLINED_VERIFICATION_REQUIRED", "INVALID_CARD_DATA", "VERIFY_CVV_FAILURE", "VERIFY_AVS_FAILURE"].includes(c))
      return "Your card was declined. Please try another card.";
    if (c === "ADDRESS_VERIFICATION_FAILURE" || c === "INVALID_POSTAL_CODE") return "The ZIP code didn't match your card.";
    if (c === "INVALID_EXPIRATION" || c === "INVALID_CARD") return "Please check your card details.";
    return "We couldn't process the payment. Please try again.";
  }
}

export async function sq<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error("SQUARE_ACCESS_TOKEN is not set");
  const res = await fetch(baseUrl() + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { errors?: SquareError["errors"] } & T;
  if (!res.ok || json.errors?.length) {
    const errs = json.errors ?? [{ code: `HTTP_${res.status}` }];
    throw new SquareError(`Square ${path}: ${errs.map((e) => `${e.code}${e.detail ? ` (${e.detail})` : ""}`).join(", ")}`, res.status, errs);
  }
  return json;
}

type SqCustomer = { id: string; email_address?: string };
export type SqCard = { id: string; card_brand: string; last_4: string; exp_month: number; exp_year: number; enabled: boolean };
export type SqPayment = { id: string; status: string; receipt_url?: string; amount_money: { amount: number }; card_details?: { card?: { card_brand: string; last_4: string } } };

export async function findOrCreateCustomer(input: { email: string; name: string; phone?: string | null; idempotencyBase: string }) {
  const found = await sq<{ customers?: SqCustomer[] }>("/v2/customers/search", {
    body: { query: { filter: { email_address: { exact: input.email } } }, limit: 1 },
  });
  if (found.customers?.[0]) return found.customers[0].id;
  const [given, ...rest] = input.name.trim().split(/\s+/);
  const created = await sq<{ customer: SqCustomer }>("/v2/customers", {
    body: {
      idempotency_key: idemKey(input.idempotencyBase, "customer"),
      given_name: given,
      family_name: rest.join(" ") || undefined,
      email_address: input.email,
      phone_number: normalizePhone(input.phone) ?? undefined,
      reference_id: "garment-booking-demo",
    },
  });
  return created.customer.id;
}

export function normalizePhone(p?: string | null) {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

/** Card on file: store the tokenised card against the Square customer. */
export async function saveCard(input: { customerId: string; sourceId: string; idempotencyKey: string; cardholderName?: string; postalCode?: string; verificationToken?: string }) {
  const r = await sq<{ card: SqCard }>("/v2/cards", {
    body: {
      idempotency_key: input.idempotencyKey,
      source_id: input.sourceId,
      verification_token: input.verificationToken,
      card: {
        customer_id: input.customerId,
        cardholder_name: input.cardholderName,
        billing_address: input.postalCode ? { postal_code: input.postalCode, country: "US" } : undefined,
      },
    },
  });
  return r.card;
}

export async function disableCard(cardId: string) {
  await sq(`/v2/cards/${cardId}/disable`, { method: "POST", body: {} }).catch(() => undefined);
}

export async function createPayment(input: {
  sourceId: string;
  amountCents: number;
  idempotencyKey: string;
  customerId?: string;
  referenceId: string;
  note: string;
  buyerEmail?: string;
  verificationToken?: string;
}) {
  const r = await sq<{ payment: SqPayment }>("/v2/payments", {
    body: {
      idempotency_key: input.idempotencyKey,
      source_id: input.sourceId,
      amount_money: { amount: input.amountCents, currency: CURRENCY },
      customer_id: input.customerId,
      location_id: locationId(),
      reference_id: input.referenceId,
      note: input.note.slice(0, 500),
      buyer_email_address: input.buyerEmail,
      verification_token: input.verificationToken,
      autocomplete: true,
    },
  });
  return r.payment;
}

export async function refundPayment(paymentId: string, amountCents: number, idempotencyKey: string, reason: string) {
  return sq("/v2/refunds", {
    body: { idempotency_key: idempotencyKey, payment_id: paymentId, amount_money: { amount: amountCents, currency: CURRENCY }, reason },
  });
}

// ---------- Subscriptions (memberships) ----------

type PlanIds = { planId: string; variationId: string; priceCents: number; env: string; locationId: string };

/**
 * Ensure the monthly membership exists in the Square catalog as a SUBSCRIPTION_PLAN with one
 * SUBSCRIPTION_PLAN_VARIATION (static monthly price). Ids are cached in the settings table.
 */
export async function ensureMembershipPlan(): Promise<PlanIds> {
  const cached = await getSetting<PlanIds>("square_membership_plan");
  if (cached && cached.env === squareEnv() && cached.priceCents === MEMBERSHIP.priceCents && cached.locationId === locationId()) {
    return cached;
  }
  const planRes = await sq<{ catalog_object: { id: string } }>("/v2/catalog/object", {
    body: {
      idempotency_key: idemKey(`plan-${MEMBERSHIP.priceCents}-${locationId()}`, "plan"),
      object: {
        type: "SUBSCRIPTION_PLAN",
        id: "#membership-plan",
        subscription_plan_data: { name: MEMBERSHIP.name, all_items: false },
      },
    },
  });
  const planId = planRes.catalog_object.id;
  const varRes = await sq<{ catalog_object: { id: string } }>("/v2/catalog/object", {
    body: {
      idempotency_key: idemKey(`plan-var-${planId}-${MEMBERSHIP.priceCents}`, "variation"),
      object: {
        type: "SUBSCRIPTION_PLAN_VARIATION",
        id: "#membership-monthly",
        subscription_plan_variation_data: {
          name: `${MEMBERSHIP.name} — Monthly`,
          subscription_plan_id: planId,
          phases: [
            {
              cadence: "MONTHLY",
              ordinal: 0,
              pricing: { type: "STATIC", price_money: { amount: MEMBERSHIP.priceCents, currency: CURRENCY } },
            },
          ],
        },
      },
    },
  });
  const ids: PlanIds = { planId, variationId: varRes.catalog_object.id, priceCents: MEMBERSHIP.priceCents, env: squareEnv(), locationId: locationId() };
  await setSetting("square_membership_plan", ids);
  return ids;
}

export type SqSubscription = {
  id: string;
  status: string; // PENDING | ACTIVE | CANCELED | DEACTIVATED | PAUSED
  card_id?: string;
  charged_through_date?: string;
  canceled_date?: string;
  start_date?: string;
  invoice_ids?: string[];
  plan_variation_id?: string;
};

export async function createSubscription(input: { customerId: string; cardId: string; planVariationId: string; idempotencyKey: string }) {
  const r = await sq<{ subscription: SqSubscription }>("/v2/subscriptions", {
    body: {
      idempotency_key: input.idempotencyKey,
      location_id: locationId(),
      plan_variation_id: input.planVariationId,
      customer_id: input.customerId,
      card_id: input.cardId,
      timezone: STORE.timezone,
      source: { name: "Marlowe & Finch web" },
    },
  });
  return r.subscription;
}

export async function retrieveSubscription(id: string) {
  return (await sq<{ subscription: SqSubscription }>(`/v2/subscriptions/${id}`)).subscription;
}

export async function cancelSubscription(id: string) {
  return (await sq<{ subscription: SqSubscription }>(`/v2/subscriptions/${id}/cancel`, { method: "POST", body: {} })).subscription;
}

export async function updateSubscriptionCard(id: string, cardId: string) {
  return (await sq<{ subscription: SqSubscription }>(`/v2/subscriptions/${id}`, { method: "PUT", body: { subscription: { card_id: cardId } } })).subscription;
}

export async function retrieveInvoice(id: string) {
  return (await sq<{ invoice: { id: string; status: string; subscription_id?: string; payment_requests?: { computed_amount_money?: { amount: number }; total_completed_amount_money?: { amount: number } }[] } }>(`/v2/invoices/${id}`)).invoice;
}

// ---------- Webhooks ----------

/**
 * Square signs webhooks with HMAC-SHA256 over (notification URL + raw body), base64, in
 * the `x-square-hmacsha256-signature` header. The URL must match the subscription URL exactly.
 */
export function verifySquareSignature(rawBody: string, signature: string | null, notificationUrl: string, signatureKey: string) {
  if (!signature || !signatureKey) return false;
  return safeEqual(hmacBase64(signatureKey, notificationUrl + rawBody), signature);
}

export function signSquarePayload(rawBody: string, notificationUrl: string, signatureKey: string) {
  return hmacBase64(signatureKey, notificationUrl + rawBody);
}
