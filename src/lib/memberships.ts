import { MEMBERSHIP, money } from "./config";
import { one, q } from "./db";
import { emailHtml, emailText, ownerEmail, sendEmail } from "./notify";
import { idemKey } from "./security";
import {
  SquareError,
  cancelSubscription,
  createSubscription,
  ensureMembershipPlan,
  findOrCreateCustomer,
  saveCard,
  updateSubscriptionCard,
  verifySquareSignature,
  type SqSubscription,
} from "./square";
import { appUrl } from "./uber";
import { CheckoutError, type CustomerRow } from "./bookings";

export type MembershipRow = {
  id: string;
  customer_id: string;
  square_subscription_id: string;
  plan_variation_id: string;
  status: "pending" | "active" | "past_due" | "canceled";
  card_id: string | null;
  started_at: Date;
  charged_through: string | null;
  canceled_at: Date | null;
  cancel_effective: string | null;
  last_invoice_id: string | null;
};

function mapStatus(s: string): MembershipRow["status"] {
  if (s === "ACTIVE") return "active";
  if (s === "PENDING") return "pending";
  return "canceled"; // CANCELED | DEACTIVATED | PAUSED
}

export async function currentMembership(customerId: string | null | undefined) {
  if (!customerId) return null;
  return one<MembershipRow>(
    "select * from memberships where customer_id = $1 order by (status <> 'canceled') desc, created_at desc limit 1",
    [customerId],
  );
}

export async function subscribe(input: { contact: { name: string; email: string; phone: string }; token: string; postalCode?: string; idempotencyKey: string }) {
  const email = input.contact.email.trim().toLowerCase();
  const prior = await one<MembershipRow>("select * from memberships where idempotency_key = $1", [input.idempotencyKey]);
  if (prior) {
    return { membership: prior, customer: (await one<CustomerRow>("select * from customers where id=$1", [prior.customer_id]))!, replayed: true };
  }
  let c = await one<CustomerRow>(
    `insert into customers (email, name, phone) values ($1,$2,$3)
     on conflict (email) do update set name = excluded.name, phone = excluded.phone, updated_at = now() returning *`,
    [email, input.contact.name.trim(), input.contact.phone.trim()],
  );
  const active = await one("select 1 from memberships where customer_id=$1 and status in ('active','pending','past_due') and cancel_effective is null", [c!.id]);
  if (active) throw new CheckoutError("You're already a member. Manage your membership below.", "already_member", 409);

  try {
    if (!c!.square_customer_id) {
      const sqId = await findOrCreateCustomer({ email, name: input.contact.name, phone: input.contact.phone, idempotencyBase: input.idempotencyKey });
      c = await one<CustomerRow>("update customers set square_customer_id=$2 where id=$1 returning *", [c!.id, sqId]);
    }
    const card = await saveCard({
      customerId: c!.square_customer_id!,
      sourceId: input.token,
      idempotencyKey: idemKey(input.idempotencyKey, "card"),
      cardholderName: input.contact.name,
      postalCode: input.postalCode,
    });
    await q("update customers set square_card_id=$2, card_brand=$3, card_last4=$4, card_exp=$5, updated_at=now() where id=$1", [
      c!.id, card.id, card.card_brand, card.last_4, `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`,
    ]);
    const plan = await ensureMembershipPlan();
    const sub = await createSubscription({
      customerId: c!.square_customer_id!,
      cardId: card.id,
      planVariationId: plan.variationId,
      idempotencyKey: idemKey(input.idempotencyKey, "subscription"),
    });
    const m = await one<MembershipRow>(
      `insert into memberships (customer_id, square_subscription_id, plan_variation_id, status, card_id, charged_through, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (square_subscription_id) do update set updated_at = now() returning *`,
      [c!.id, sub.id, plan.variationId, mapStatus(sub.status), card.id, sub.charged_through_date ?? null, input.idempotencyKey],
    );
    const rows: [string, string][] = [
      ["Plan", `${MEMBERSHIP.name} · ${money(MEMBERSHIP.priceCents)}/month`],
      ["Card", `${card.card_brand.replace(/_/g, " ")} •••• ${card.last_4}`],
      ["Perks", MEMBERSHIP.perks.join(" · ")],
    ];
    const intro = `Welcome, ${input.contact.name.split(" ")[0]}. Your membership is live — Uber pickup and delivery are now on us.`;
    await sendEmail({ audience: "customer", to: email, subject: `Welcome to ${MEMBERSHIP.name}`, text: emailText("Membership confirmed", rows, intro, { label: "Book a pickup", href: `${appUrl()}/book/pickup` }), html: emailHtml("Membership confirmed", rows, intro, { label: "Book a pickup", href: `${appUrl()}/book/pickup` }), membershipId: m!.id });
    await sendEmail({ audience: "owner", to: ownerEmail(), subject: `New member: ${input.contact.name} · ${money(MEMBERSHIP.priceCents)}/mo`, text: `New membership for ${input.contact.name} (${email}). Square subscription ${sub.id}.`, html: emailHtml("New membership", [["Member", `${input.contact.name} · ${email} · ${input.contact.phone}`], ["Square subscription", sub.id], ["Status", sub.status]], "A customer just subscribed online.", { label: "Open dashboard", href: `${appUrl()}/admin` }), membershipId: m!.id });
    return { membership: m!, customer: c!, replayed: false };
  } catch (e) {
    if (e instanceof SquareError) throw new CheckoutError(e.friendly, e.code === "INVALID_PHONE_NUMBER" || e.code === "INVALID_EMAIL_ADDRESS" ? "customer_failed" : "payment_failed", 402, { squareCode: e.code });
    throw e;
  }
}

export async function cancelMembership(customerId: string) {
  const m = await currentMembership(customerId);
  if (!m || m.status === "canceled") throw new CheckoutError("No active membership found.", "no_membership", 404);
  if (m.cancel_effective) return m;
  let sub: SqSubscription;
  try {
    sub = await cancelSubscription(m.square_subscription_id);
  } catch (e) {
    if (e instanceof SquareError && e.code === "BAD_REQUEST") throw new CheckoutError("This membership is already scheduled to end.", "already_canceled", 409);
    throw e;
  }
  const effective = sub.canceled_date ?? new Date().toISOString().slice(0, 10);
  const immediate = sub.status !== "ACTIVE";
  const updated = await one<MembershipRow>(
    "update memberships set cancel_effective=$2, canceled_at=now(), status=$3, updated_at=now() where id=$1 returning *",
    [m.id, effective, immediate ? "canceled" : m.status],
  );
  const c = (await one<CustomerRow>("select * from customers where id=$1", [customerId]))!;
  await sendEmail({ audience: "customer", to: c.email, subject: `Your membership ends ${effective}`, text: `Your ${MEMBERSHIP.name} has been canceled and ends on ${effective}. You won't be charged again.`, html: emailHtml("Membership canceled", [["Ends", effective]], "You won't be charged again. Your perks stay active until then.") , membershipId: m.id });
  await sendEmail({ audience: "owner", to: ownerEmail(), subject: `Member canceled: ${c.name}`, text: `${c.name} canceled; ends ${effective}.`, html: emailHtml("Member canceled", [["Member", `${c.name} · ${c.email}`], ["Ends", effective]], "A member canceled online."), membershipId: m.id });
  return updated!;
}

export async function updateMembershipCard(customerId: string, token: string, idempotencyKey: string, postalCode?: string) {
  const m = await currentMembership(customerId);
  const c = await one<CustomerRow>("select * from customers where id=$1", [customerId]);
  if (!m || !c?.square_customer_id || m.status === "canceled") throw new CheckoutError("No active membership found.", "no_membership", 404);
  try {
    const card = await saveCard({ customerId: c.square_customer_id, sourceId: token, idempotencyKey: idemKey(idempotencyKey, "card"), cardholderName: c.name, postalCode });
    await updateSubscriptionCard(m.square_subscription_id, card.id);
    await q("update memberships set card_id=$2, updated_at=now() where id=$1", [m.id, card.id]);
    await q("update customers set square_card_id=$2, card_brand=$3, card_last4=$4, card_exp=$5, updated_at=now() where id=$1", [
      c.id, card.id, card.card_brand, card.last_4, `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`,
    ]);
    return card;
  } catch (e) {
    if (e instanceof SquareError) throw new CheckoutError(e.friendly, "card_failed", 402, { squareCode: e.code });
    throw e;
  }
}

// ---------- Square webhooks ----------

type SquareEvent = {
  merchant_id?: string;
  type: string;
  event_id: string;
  created_at?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Square event payloads vary by type
  data?: { type?: string; id?: string; object?: Record<string, any> };
};

export function squareWebhookUrl() {
  return process.env.SQUARE_WEBHOOK_URL || `${appUrl()}/api/webhooks/square`;
}

export async function handleSquareWebhook(rawBody: string, signature: string | null) {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "";
  if (!verifySquareSignature(rawBody, signature, squareWebhookUrl(), key)) return { ok: false as const, status: 401, reason: "bad_signature" };
  let ev: SquareEvent;
  try {
    ev = JSON.parse(rawBody);
  } catch {
    return { ok: false as const, status: 400, reason: "bad_json" };
  }
  if (!ev.event_id || !ev.type) return { ok: false as const, status: 400, reason: "missing_fields" };
  const inserted = await q(
    "insert into webhook_events (provider, event_id, type, payload) values ('square', $1, $2, $3) on conflict do nothing returning event_id",
    [ev.event_id, ev.type, rawBody],
  );
  if (!inserted.length) return { ok: true as const, status: 200, duplicate: true };

  const obj = ev.data?.object ?? {};
  switch (ev.type) {
    case "invoice.payment_made":
      await onInvoicePaid(obj.invoice);
      break;
    case "invoice.scheduled_charge_failed":
      await onInvoiceFailed(obj.invoice);
      break;
    case "subscription.created":
    case "subscription.updated":
      await onSubscriptionUpdated(obj.subscription);
      break;
    case "payment.updated":
    case "payment.created":
      if (obj.payment?.id) await q("update payments set status=$2 where square_payment_id=$1", [obj.payment.id, obj.payment.status]);
      if (obj.payment?.id) await q("update bookings set payment_status=$2 where square_payment_id=$1", [obj.payment.id, obj.payment.status]);
      break;
  }
  return { ok: true as const, status: 200, duplicate: false };
}

type Invoice = { id: string; subscription_id?: string; status?: string; payment_requests?: { computed_amount_money?: { amount: number }; total_completed_amount_money?: { amount: number } }[] };

function invoiceAmount(inv: Invoice) {
  const pr = inv.payment_requests?.[0];
  return pr?.total_completed_amount_money?.amount || pr?.computed_amount_money?.amount || MEMBERSHIP.priceCents;
}

async function onInvoicePaid(inv: Invoice | undefined) {
  if (!inv?.subscription_id) return;
  const m = await one<MembershipRow>("select * from memberships where square_subscription_id=$1", [inv.subscription_id]);
  if (!m) return;
  await q("update memberships set status = case when status='canceled' then status else 'active' end, last_invoice_id=$2, updated_at=now() where id=$1", [m.id, inv.id]);
  await q(
    `insert into payments (customer_id, membership_id, kind, square_invoice_id, amount_cents, status)
     values ($1,$2,'subscription',$3,$4,'PAID') on conflict do nothing`,
    [m.customer_id, m.id, inv.id, invoiceAmount(inv)],
  );
}

async function onInvoiceFailed(inv: Invoice | undefined) {
  if (!inv?.subscription_id) return;
  const m = await one<MembershipRow>("select * from memberships where square_subscription_id=$1", [inv.subscription_id]);
  if (!m) return;
  await q("update memberships set status='past_due', last_invoice_id=$2, updated_at=now() where id=$1 and status <> 'canceled'", [m.id, inv.id]);
  await q(
    `insert into payments (customer_id, membership_id, kind, square_invoice_id, amount_cents, status)
     values ($1,$2,'subscription',$3,$4,'FAILED') on conflict do nothing`,
    [m.customer_id, m.id, inv.id, invoiceAmount(inv)],
  );
  const c = (await one<CustomerRow>("select * from customers where id=$1", [m.customer_id]))!;
  const link = `${appUrl()}/membership`;
  await sendEmail({ audience: "customer", to: c.email, subject: "Your membership payment didn't go through", text: emailText("Payment failed", [["Amount", money(invoiceAmount(inv))]], "We couldn't charge your card for this month's membership. Update your card to keep free pickup and delivery.", { label: "Update card", href: link }), html: emailHtml("Payment failed", [["Amount", money(invoiceAmount(inv))]], "We couldn't charge your card for this month's membership. Update your card to keep free pickup and delivery.", { label: "Update card", href: link }), membershipId: m.id });
  await sendEmail({ audience: "owner", to: ownerEmail(), subject: `Membership payment failed: ${c.name}`, text: `Square could not charge ${c.name} (${c.email}) for invoice ${inv.id}.`, html: emailHtml("Membership payment failed", [["Member", `${c.name} · ${c.email}`], ["Invoice", inv.id]], "Square could not charge the card on file. The member has been asked to update their card."), membershipId: m.id });
}

async function onSubscriptionUpdated(sub: SqSubscription | undefined) {
  if (!sub?.id) return;
  const status = mapStatus(sub.status);
  await q(
    `update memberships set
       status = case when $2 = 'active' and status = 'past_due' then status else $2 end,
       charged_through = coalesce($3::date, charged_through),
       cancel_effective = coalesce($4::date, cancel_effective),
       card_id = coalesce($5, card_id),
       updated_at = now()
     where square_subscription_id = $1`,
    [sub.id, status, sub.charged_through_date ?? null, sub.canceled_date ?? null, sub.card_id ?? null],
  );
  if (sub.status === "DEACTIVATED") {
    const m = await one<{ id: string; name: string; email: string }>(
      "select m.id, c.name, c.email from memberships m join customers c on c.id = m.customer_id where m.square_subscription_id = $1",
      [sub.id],
    );
    if (m) {
      await sendEmail({ audience: "owner", to: ownerEmail(), subject: `Square deactivated a membership: ${m.name}`, text: `Square marked subscription ${sub.id} (${m.name}, ${m.email}) as non-billable — usually an invalid customer email or a removed profile. Fix it in the Square Dashboard and resume the subscription.`, html: emailHtml("Membership deactivated by Square", [["Member", `${m.name} · ${m.email}`], ["Subscription", sub.id]], "Square marked this subscription non-billable (usually an invalid customer email or a deleted profile). Fix the customer in the Square Dashboard and resume it."), membershipId: m.id });
    }
  }
}
