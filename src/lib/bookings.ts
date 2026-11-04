import { BRAND, MEMBERSHIP, SERVICES, STORE, money } from "./config";
import { one, q } from "./db";
import { emailHtml, emailText, ownerEmail, ownerPhone, sendEmail, sendSms } from "./notify";
import { bookingRef, idemKey } from "./security";
import { SquareError, createPayment, findOrCreateCustomer, saveCard } from "./square";
import { formatWhen, isValidWindow } from "./time";
import { appUrl, getUber, signUberPayload, uberWebhookKey, verifyUberSignature, type Address, type Courier, type UberStatus } from "./uber";
import { MOCK_TIMELINE, mockCourierFor } from "./uber/mock";
import { UberError } from "./uber/types";

export type Kind = "pickup" | "delivery";

export type CustomerRow = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  square_customer_id: string | null;
  square_card_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp: string | null;
};

export type BookingRow = {
  id: string;
  ref: string;
  kind: Kind;
  status: string;
  customer_id: string;
  address: Address & { label?: string };
  unit: string | null;
  instructions: string | null;
  window_start: Date;
  window_end: Date;
  items: { id: string; name: string; qty: number; unitCents: number }[];
  notes: string | null;
  ticket_number: string | null;
  service_cents: number;
  discount_cents: number;
  delivery_fee_cents: number;
  delivery_fee_waived: boolean;
  total_cents: number;
  quote_id: string | null;
  uber_mode: string | null;
  uber_delivery_id: string | null;
  uber_tracking_url: string | null;
  uber_status: UberStatus | null;
  courier: Courier | null;
  dispatch_error: string | null;
  dispatched_at: Date | null;
  square_payment_id: string | null;
  square_receipt_url: string | null;
  payment_status: string | null;
  idempotency_key: string;
  created_at: Date;
};

export class CheckoutError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const STORE_STOP = { name: STORE.name, phone: "+19735550142" };

// ---------- members & pricing ----------

export async function isActiveMember(customerId: string | null | undefined) {
  if (!customerId) return false;
  const r = await one("select 1 from memberships where customer_id = $1 and status in ('active','pending') limit 1", [customerId]);
  return Boolean(r);
}

export function priceItems(items: { id: string; qty: number }[]) {
  const lines = items
    .filter((i) => i.qty > 0)
    .map((i) => {
      const s = SERVICES.find((x) => x.id === i.id);
      if (!s) throw new CheckoutError("Unknown item", "bad_item");
      return { id: s.id, name: s.name, qty: Math.min(Math.floor(i.qty), 50), unitCents: s.unitCents };
    });
  return { lines, serviceCents: lines.reduce((a, l) => a + l.qty * l.unitCents, 0) };
}

export function totals(serviceCents: number, feeCents: number, member: boolean) {
  const discountCents = member ? Math.round((serviceCents * MEMBERSHIP.discountPct) / 100) : 0;
  const chargedFee = member ? 0 : feeCents;
  return { serviceCents, discountCents, feeCents, chargedFee, waived: member, totalCents: serviceCents - discountCents + chargedFee };
}

// ---------- quotes ----------

function legs(kind: Kind, customer: Address, windowStart?: Date, windowEnd?: Date) {
  const store: Address = { ...STORE.address };
  if (kind === "pickup") {
    // Courier collects from the customer during their window and brings garments to the shop.
    return { pickup: customer, dropoff: store, pickupReadyAt: windowStart, pickupDeadlineAt: windowEnd };
  }
  // Shop → customer: garments are ready at the counter, dropped off within the window.
  const ready = windowStart ? new Date(Math.max(Date.now(), windowStart.getTime() - 30 * 60_000)) : undefined;
  return { pickup: store, dropoff: customer, pickupReadyAt: ready, dropoffReadyAt: windowStart, dropoffDeadlineAt: windowEnd };
}

export async function createQuote(kind: Kind, address: Address, windowStartIso?: string | null) {
  let windowStart: Date | undefined;
  let windowEnd: Date | undefined;
  if (windowStartIso) {
    const w = isValidWindow(windowStartIso);
    if (!w) throw new CheckoutError("That time window is no longer available.", "bad_window");
    windowStart = new Date(w.start);
    windowEnd = new Date(w.end);
  }
  const uber = getUber();
  const quote = await uber.createQuote(legs(kind, address, windowStart, windowEnd));
  const row = await one<{ id: string }>(
    `insert into quotes (provider, provider_quote_id, kind, address, window_start, fee_cents, eta_minutes, dropoff_eta, distance_miles, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [uber.mode, quote.providerQuoteId, kind, JSON.stringify(address), windowStart ?? null, quote.feeCents, quote.etaMinutes, quote.dropoffEta, quote.distanceMiles ?? null, quote.expiresAt],
  );
  return { quoteId: row!.id, mode: uber.mode, ...quote };
}

type QuoteRow = { id: string; provider: string; provider_quote_id: string; kind: Kind; address: Address; window_start: Date | null; fee_cents: number; eta_minutes: number; expires_at: Date };

// ---------- checkout ----------

export type CheckoutInput = {
  kind: Kind;
  quoteId: string;
  address: Address & { label?: string };
  unit?: string | null;
  instructions?: string | null;
  windowStart: string;
  items: { id: string; qty: number }[];
  notes?: string | null;
  ticketNumber?: string | null;
  contact: { name: string; email: string; phone: string };
  payment: { token: string; saveCard: boolean; postalCode?: string } | { useSavedCard: true };
  idempotencyKey: string;
  acceptFee?: number; // customer accepted a re-priced fee (cents)
};

export async function checkout(input: CheckoutInput, sessionCustomerId: string | null) {
  // 1. Idempotency: the same attempt key returns the same booking (double taps, retries).
  const existing = await one<BookingRow>("select * from bookings where idempotency_key = $1", [input.idempotencyKey]);
  if (existing && existing.status !== "pending_payment" && existing.status !== "payment_failed") {
    return { booking: existing, replayed: true };
  }
  if (existing?.status === "payment_failed") {
    throw new CheckoutError("This payment attempt already failed. Please try again.", "attempt_used", 409);
  }

  const window = isValidWindow(input.windowStart);
  if (!window) throw new CheckoutError("That time window is no longer available. Please pick another.", "bad_window");
  const { lines, serviceCents } = priceItems(input.items);
  if (!lines.length) throw new CheckoutError("Add at least one garment so we can estimate your order.", "no_items");

  // 2. Quote: must be ours, unexpired, for this window. Otherwise re-quote; if the fee went up, ask first.
  let quote = await one<QuoteRow>("select * from quotes where id = $1", [input.quoteId]);
  if (!quote || quote.kind !== input.kind) throw new CheckoutError("Delivery quote not found. Please re-enter your address.", "bad_quote");
  const sameWindow = quote.window_start && new Date(quote.window_start).toISOString() === window.start;
  if (quote.expires_at.getTime() < Date.now() + 30_000 || !sameWindow || quote.provider !== getUber().mode) {
    const fresh = await createQuote(input.kind, quote.address, window.start);
    if (fresh.feeCents > quote.fee_cents && input.acceptFee !== fresh.feeCents) {
      throw new CheckoutError("The Uber delivery fee changed for this time.", "fee_changed", 409, {
        quoteId: fresh.quoteId,
        feeCents: fresh.feeCents,
        etaMinutes: fresh.etaMinutes,
      });
    }
    quote = await one<QuoteRow>("select * from quotes where id = $1", [fresh.quoteId]);
  }
  const q0 = quote!;

  // 3. Customer (local + Square). Saved-card checkout requires the remembered-device session.
  let customer: CustomerRow;
  if ("useSavedCard" in input.payment) {
    const c = sessionCustomerId ? await one<CustomerRow>("select * from customers where id = $1", [sessionCustomerId]) : null;
    if (!c?.square_card_id || !c.square_customer_id) throw new CheckoutError("No saved card on this device. Please enter a card.", "no_saved_card");
    customer = c;
  } else {
    try {
      customer = await upsertCustomer(input.contact, input.idempotencyKey);
    } catch (e) {
      if (e instanceof SquareError) throw new CheckoutError(e.friendly, "customer_failed", 400, { squareCode: e.code });
      throw e;
    }
  }
  const member = await isActiveMember(customer.id);
  const t = totals(serviceCents, q0.fee_cents, member);

  // 4. Booking row first (pending), so a crash between pay and dispatch is recoverable.
  const ref = existing?.ref ?? bookingRef();
  const booking =
    existing ??
    (await one<BookingRow>(
      `insert into bookings (ref, kind, customer_id, address, unit, instructions, window_start, window_end, items, notes, ticket_number,
         service_cents, discount_cents, delivery_fee_cents, delivery_fee_waived, total_cents, quote_id, uber_mode, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       on conflict (idempotency_key) do update set updated_at = now()
       returning *`,
      [
        ref, input.kind, customer.id, JSON.stringify(input.address), input.unit || null, input.instructions || null,
        window.start, window.end, JSON.stringify(lines), input.notes || null, input.ticketNumber || null,
        t.serviceCents, t.discountCents, t.feeCents, t.waived, t.totalCents, q0.id, q0.provider, input.idempotencyKey,
      ],
    ))!;

  // 5. Square payment (card on file or one-time token). Every call carries a derived idempotency key.
  let sourceId: string;
  try {
    if ("useSavedCard" in input.payment) {
      sourceId = customer.square_card_id!;
    } else if (input.payment.saveCard) {
      const card = await saveCard({
        customerId: customer.square_customer_id!,
        sourceId: input.payment.token,
        idempotencyKey: idemKey(input.idempotencyKey, "card"),
        cardholderName: input.contact.name,
        postalCode: input.payment.postalCode,
      });
      await q(
        "update customers set square_card_id=$2, card_brand=$3, card_last4=$4, card_exp=$5, updated_at=now() where id=$1",
        [customer.id, card.id, card.card_brand, card.last_4, `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`],
      );
      sourceId = card.id;
    } else {
      sourceId = input.payment.token;
    }
    const payment = await createPayment({
      sourceId,
      amountCents: t.totalCents,
      idempotencyKey: idemKey(input.idempotencyKey, "payment"),
      customerId: customer.square_customer_id!,
      referenceId: ref,
      note: `${input.kind === "pickup" ? "Pickup" : "Delivery"} ${ref} — ${lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}`,
      buyerEmail: customer.email,
    });
    await q(
      "update bookings set status='paid', square_payment_id=$2, square_receipt_url=$3, payment_status=$4, updated_at=now() where id=$1",
      [booking.id, payment.id, payment.receipt_url ?? null, payment.status],
    );
    await q(
      `insert into payments (customer_id, booking_id, kind, square_payment_id, amount_cents, status, receipt_url)
       values ($1,$2,'booking',$3,$4,$5,$6) on conflict (square_payment_id) do nothing`,
      [customer.id, booking.id, payment.id, payment.amount_money.amount, payment.status, payment.receipt_url ?? null],
    );
  } catch (e) {
    if (e instanceof SquareError) {
      await q("update bookings set status='payment_failed', payment_status=$2, updated_at=now() where id=$1", [booking.id, e.code]);
      throw new CheckoutError(e.friendly, "payment_failed", 402, { squareCode: e.code });
    }
    throw e;
  }

  // 6. Dispatch the Uber courier. Payment is already captured, so a dispatch failure alerts the owner instead of failing the order.
  await dispatch(booking.id);

  const final = (await one<BookingRow>("select * from bookings where id = $1", [booking.id]))!;
  await notifyNewBooking(final, customer, member);
  return { booking: final, customer, replayed: false };
}

async function upsertCustomer(contact: CheckoutInput["contact"], idempotencyBase: string) {
  const email = contact.email.trim().toLowerCase();
  let c = await one<CustomerRow>("select * from customers where email = $1", [email]);
  if (!c) {
    c = await one<CustomerRow>(
      "insert into customers (email, name, phone) values ($1,$2,$3) on conflict (email) do update set name = excluded.name returning *",
      [email, contact.name.trim(), contact.phone.trim()],
    );
  } else {
    await q("update customers set name=$2, phone=$3, updated_at=now() where id=$1", [c.id, contact.name.trim(), contact.phone.trim()]);
  }
  if (!c!.square_customer_id) {
    const sqId = await findOrCreateCustomer({ email, name: contact.name, phone: contact.phone, idempotencyBase });
    c = await one<CustomerRow>("update customers set square_customer_id=$2 where id=$1 returning *", [c!.id, sqId]);
  }
  return c!;
}

export async function dispatch(bookingId: string) {
  const b = (await one<BookingRow & { email: string; name: string; phone: string }>(
    "select b.*, c.email, c.name, c.phone from bookings b join customers c on c.id = b.customer_id where b.id = $1",
    [bookingId],
  ))!;
  if (b.uber_delivery_id) return;
  const quote = (await one<QuoteRow>("select * from quotes where id = $1", [b.quote_id]))!;
  const customerAddr: Address = { ...b.address, line2: b.unit };
  const customerStop = {
    name: b.name,
    phone: b.phone,
    address: customerAddr,
    notes: [b.unit && `Unit ${b.unit}`, b.instructions].filter(Boolean).join(". ") || undefined,
  };
  const storeStop = { ...STORE_STOP, address: { ...STORE.address }, notes: STORE.handoffNotes };
  const l = legs(b.kind, customerAddr, new Date(b.window_start), new Date(b.window_end));
  try {
    const d = await getUber().createDelivery({
      ...l,
      quoteId: quote.provider_quote_id,
      pickupStop: b.kind === "pickup" ? customerStop : storeStop,
      dropoffStop: b.kind === "pickup" ? storeStop : customerStop,
      externalId: b.ref,
      manifest: b.items.map((i) => ({ name: i.name, quantity: i.qty })),
      manifestValueCents: b.service_cents,
      idempotencyKey: idemKey(b.idempotency_key, "uber-delivery"),
    });
    await q(
      `update bookings set status='dispatched', uber_delivery_id=$2, uber_tracking_url=$3, uber_status=$4, dispatched_at=now(),
         dispatch_error=null, updated_at=now() where id=$1`,
      [b.id, d.id, d.trackingUrl, d.status],
    );
    await q("insert into delivery_events (booking_id, status, detail) values ($1,'pending','Courier requested from Uber Direct')", [b.id]);
  } catch (e) {
    const msg = e instanceof UberError ? `${e.code}: ${e.message}` : String(e);
    await q("update bookings set status='dispatch_failed', dispatch_error=$2, updated_at=now() where id=$1", [b.id, msg]);
    await sendEmail({
      audience: "owner",
      to: ownerEmail(),
      subject: `Action needed: Uber dispatch failed for ${b.ref}`,
      text: `Payment was taken but the Uber courier could not be booked (${msg}). Open /admin to retry or arrange the run manually.`,
      html: emailHtml("Uber dispatch failed", [["Booking", b.ref], ["Error", msg]], "Payment was taken but the courier could not be booked. Retry from the admin dashboard or arrange the run manually.", { label: "Open admin", href: `${appUrl()}/admin` }),
      bookingId: b.id,
    });
  }
}

export function kindLabel(kind: Kind) {
  return kind === "pickup" ? "Pickup" : "Delivery";
}

async function notifyNewBooking(b: BookingRow, c: CustomerRow, member: boolean) {
  const when = formatWhen(b.window_start, b.window_end);
  const addr = `${b.address.line1}${b.unit ? `, ${b.unit}` : ""}, ${b.address.city}, ${b.address.state} ${b.address.zip}`;
  const rows: [string, string][] = [
    ["Reference", b.ref],
    [b.kind === "pickup" ? "Pickup window" : "Delivery window", when],
    [b.kind === "pickup" ? "Collect from" : "Deliver to", addr],
    ["Garments", b.items.map((i) => `${i.qty}× ${i.name}`).join(", ")],
    ["Service estimate", money(b.service_cents)],
    ...(b.discount_cents ? ([["Member discount", `−${money(b.discount_cents)}`]] as [string, string][]) : []),
    ["Uber courier", b.delivery_fee_waived ? `${money(b.delivery_fee_cents)} covered by membership` : money(b.delivery_fee_cents)],
    ["Paid", money(b.total_cents)],
  ];
  const link = `${appUrl()}/confirmation/${b.ref}`;
  const title = b.kind === "pickup" ? "Your pickup is booked" : "Your delivery is booked";
  const intro =
    b.kind === "pickup"
      ? `Thanks, ${c.name.split(" ")[0]}. An Uber courier will collect your garments ${when} and bring them to our Church Street atelier.`
      : `Thanks, ${c.name.split(" ")[0]}. Your garments will leave our Church Street atelier with an Uber courier ${when}.`;
  await sendEmail({ audience: "customer", to: c.email, subject: `${title} · ${b.ref}`, text: emailText(title, rows, intro, { label: "Track your courier", href: link }), html: emailHtml(title, rows, intro, { label: "Track your courier", href: link }), bookingId: b.id });
  await sendSms({ audience: "customer", to: c.phone, body: `${BRAND.name}: ${kindLabel(b.kind)} ${b.ref} confirmed for ${when}. Track: ${link}`, bookingId: b.id });

  const ownerRows: [string, string][] = [["Customer", `${c.name} · ${c.email} · ${c.phone ?? ""}`], ["Member", member ? "Yes" : "No"], ...rows, ["Uber", b.uber_delivery_id ? `${b.uber_delivery_id} (${b.uber_mode})` : `NOT DISPATCHED — ${b.dispatch_error}`], ["Notes", b.notes || "—"], ...(b.ticket_number ? ([["Ticket #", b.ticket_number]] as [string, string][]) : [])];
  await sendEmail({ audience: "owner", to: ownerEmail(), subject: `New ${b.kind}: ${b.ref} · ${c.name} · ${money(b.total_cents)}`, text: emailText(`New ${b.kind} request`, ownerRows, "A customer just booked and paid online."), html: emailHtml(`New ${b.kind} request`, ownerRows, "A customer just booked and paid online.", { label: "Open dashboard", href: `${appUrl()}/admin` }), bookingId: b.id });
  await sendSms({ audience: "owner", to: ownerPhone(), body: `New ${b.kind} ${b.ref} · ${c.name} · ${when}`, bookingId: b.id });
}

// ---------- Uber status webhooks ----------

const ORDER: Record<string, number> = { pending: 0, pickup: 1, pickup_complete: 2, dropoff: 3, delivered: 4, canceled: 9, returned: 9 };
const BOOKING_STATUS: Record<string, string> = {
  pending: "dispatched",
  pickup: "courier_assigned",
  pickup_complete: "picked_up",
  dropoff: "en_route",
  delivered: "delivered",
  canceled: "canceled",
  returned: "returned",
};

export type UberEvent = {
  id: string;
  kind: string; // "event.delivery_status" | "event.courier_update"
  delivery_id: string;
  status: UberStatus;
  created?: string;
  live_mode?: boolean;
  data?: { id?: string; status?: UberStatus; courier?: Courier | null; tracking_url?: string };
};

/** Verify + de-duplicate + apply. Used by the webhook route and by the mock simulator. */
export async function handleUberWebhook(rawBody: string, signature: string | null) {
  if (!verifyUberSignature(rawBody, signature, uberWebhookKey())) return { ok: false as const, status: 401, reason: "bad_signature" };
  let ev: UberEvent;
  try {
    ev = JSON.parse(rawBody);
  } catch {
    return { ok: false as const, status: 400, reason: "bad_json" };
  }
  if (!ev.id || !ev.delivery_id) return { ok: false as const, status: 400, reason: "missing_fields" };
  const inserted = await q(
    "insert into webhook_events (provider, event_id, type, payload) values ('uber', $1, $2, $3) on conflict do nothing returning event_id",
    [ev.id, ev.kind, rawBody],
  );
  if (!inserted.length) return { ok: true as const, status: 200, duplicate: true };
  if (ev.kind !== "event.delivery_status") return { ok: true as const, status: 200, ignored: true };
  await applyUberStatus(ev);
  return { ok: true as const, status: 200, duplicate: false };
}

async function applyUberStatus(ev: UberEvent) {
  const status = ev.status ?? ev.data?.status;
  const b = await one<BookingRow & { email: string; name: string; phone: string }>(
    "select b.*, c.email, c.name, c.phone from bookings b join customers c on c.id=b.customer_id where uber_delivery_id = $1",
    [ev.delivery_id],
  );
  if (!b || !status) return;
  const current = ORDER[b.uber_status ?? "pending"] ?? 0;
  const next = ORDER[status] ?? 0;
  if (next < current || (current === 9 && next === 9)) return; // out-of-order or already terminal
  await q(
    "update bookings set uber_status=$2, status=$3, courier=coalesce($4, courier), uber_tracking_url=coalesce($5, uber_tracking_url), updated_at=now() where id=$1",
    [b.id, status, BOOKING_STATUS[status] ?? b.status, ev.data?.courier ? JSON.stringify(ev.data.courier) : null, ev.data?.tracking_url ?? null],
  );
  await q("insert into delivery_events (booking_id, status, detail) values ($1,$2,$3)", [b.id, status, statusLabel(b.kind, status, ev.data?.courier ?? b.courier)]);

  const link = `${appUrl()}/confirmation/${b.ref}`;
  if (status === "pickup") {
    await sendSms({ audience: "customer", to: b.phone, body: `${BRAND.name}: ${statusLabel(b.kind, status, ev.data?.courier ?? null)}. Track: ${link}`, bookingId: b.id });
  }
  if (status === "delivered") {
    const title = b.kind === "pickup" ? "Your garments have arrived at the atelier" : "Your garments have been delivered";
    await sendEmail({ audience: "customer", to: b.email, subject: `${title} · ${b.ref}`, text: emailText(title, [["Reference", b.ref]], "Thank you for choosing Marlowe & Finch."), html: emailHtml(title, [["Reference", b.ref]], "Thank you for choosing Marlowe & Finch."), bookingId: b.id });
  }
  if (status === "canceled" || status === "returned") {
    await sendEmail({ audience: "owner", to: ownerEmail(), subject: `Uber ${status}: ${b.ref}`, text: `Uber reported the courier run for ${b.ref} as ${status}. Contact ${b.name} (${b.phone}).`, html: emailHtml(`Uber ${status}`, [["Booking", b.ref], ["Customer", `${b.name} · ${b.phone}`]], `Uber reported this courier run as ${status}. Contact the customer to rebook.`, { label: "Open admin", href: `${appUrl()}/admin` }), bookingId: b.id });
  }
}

export function statusLabel(kind: Kind, status: string, courier?: Courier | null) {
  const who = courier?.name ?? "Your courier";
  switch (status) {
    case "pending":
      return "Courier requested";
    case "pickup":
      return kind === "pickup" ? `${who} is on the way to collect your garments` : `${who} is heading to the atelier`;
    case "pickup_complete":
      return kind === "pickup" ? `${who} has your garments` : `${who} has collected your order`;
    case "dropoff":
      return kind === "pickup" ? "On the way to the atelier" : "On the way to you";
    case "delivered":
      return kind === "pickup" ? "Received at the atelier" : "Delivered";
    case "canceled":
      return "Courier canceled — we'll be in touch";
    case "returned":
      return "Returned to sender";
    default:
      return status;
  }
}

// ---------- mock simulator (only when Uber credentials are absent) ----------

/** Emit the next signed status events for mock deliveries whose time has come. Idempotent. */
export async function advanceMockDeliveries(ref?: string) {
  const rows = await q<BookingRow>(
    `select * from bookings where uber_mode = 'uber-mock' and uber_delivery_id is not null and dispatched_at is not null
       and coalesce(uber_status,'pending') not in ('delivered','canceled','returned') ${ref ? "and ref = $1" : ""} limit 50`,
    ref ? [ref] : [],
  );
  const key = uberWebhookKey();
  for (const b of rows) {
    const elapsed = (Date.now() - new Date(b.dispatched_at!).getTime()) / 1000;
    const current = ORDER[b.uber_status ?? "pending"] ?? 0;
    for (const step of MOCK_TIMELINE) {
      if (step.afterSec > elapsed || ORDER[step.status] <= current) continue;
      const courier = ORDER[step.status] >= 1 ? mockCourierFor(b.uber_delivery_id!) : null;
      const ev: UberEvent = {
        id: `evt_mock_${b.uber_delivery_id}_${step.status}`,
        kind: "event.delivery_status",
        delivery_id: b.uber_delivery_id!,
        status: step.status,
        created: new Date(new Date(b.dispatched_at!).getTime() + step.afterSec * 1000).toISOString(),
        live_mode: false,
        data: { id: b.uber_delivery_id!, status: step.status, courier },
      };
      const raw = JSON.stringify(ev);
      await handleUberWebhook(raw, signUberPayload(raw, key));
    }
  }
}

export async function getBookingByRef(ref: string) {
  return one<BookingRow & { name: string; email: string; phone: string; card_brand: string | null; card_last4: string | null }>(
    "select b.*, c.name, c.email, c.phone, c.card_brand, c.card_last4 from bookings b join customers c on c.id = b.customer_id where b.ref = $1",
    [ref],
  );
}

export async function deliveryEvents(bookingId: string) {
  return q<{ status: string; detail: string; at: Date }>("select status, detail, at from delivery_events where booking_id=$1 order by at, id", [bookingId]);
}
