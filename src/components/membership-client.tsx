"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { MEMBERSHIP, money } from "@/lib/config";
import { Field, PhoneError, cardName, phoneShowsError } from "./booking-flow";
import { isValidUsPhone } from "@/lib/phone";
import { SquareCard, type SquareCardHandle } from "./square-card";

type M = { status: string; chargedThrough: string | null; cancelEffective: string | null; startedAt: string } | null;
type Me = { name: string; email: string; phone: string; card: { brand: string | null; last4: string | null } | null } | null;

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function MembershipClient({ square, me, membership }: { square: { appId: string; locationId: string; env: string }; me: Me; membership: M }) {
  const router = useRouter();
  const cardRef = useRef<SquareCardHandle>(null);
  const [contact, setContact] = useState({ name: me?.name ?? "", email: me?.email ?? "", phone: me?.phone ?? "" });
  const [idem, setIdem] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const live = membership && membership.status !== "canceled";

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw Object.assign(new Error(j.error ?? "Something went wrong."), { code: j.code });
    return j;
  }

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      const t = await cardRef.current!.tokenize();
      await post("/api/membership/subscribe", { contact, token: t.token, postalCode: t.postalCode, idempotencyKey: idem });
      setNotice("Welcome to the membership. A confirmation is on its way.");
      setIdem(crypto.randomUUID()); // next card action is a new attempt
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setIdem(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  async function updateCard() {
    setBusy(true);
    setError(null);
    try {
      const t = await cardRef.current!.tokenize();
      const j = await post("/api/membership/card", { token: t.token, postalCode: t.postalCode, idempotencyKey: idem });
      setNotice(`Card updated to ${cardName(j.card.brand)} •••• ${j.card.last4}.`);
      setEditingCard(false);
      setIdem(crypto.randomUUID());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setIdem(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const j = await post("/api/membership/cancel", {});
      setNotice(j.status !== "canceled" && j.cancelEffective ? `Canceled. Your perks continue until ${fmtDate(j.cancelEffective)}.` : "Membership canceled. You won't be charged again.");
      setConfirmCancel(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const contactValid = contact.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(contact.email) && isValidUsPhone(contact.phone);

  return (
    <div className="mt-6 pb-10">
      {notice && <p role="status" className="mb-4 rounded-xl bg-ok/10 p-3 text-sm text-ok" data-testid="member-notice">{notice}</p>}
      {live ? (
        <section className="card p-5" data-testid="manage">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl text-forest">Your membership</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${membership.status === "past_due" ? "bg-bad/10 text-bad" : "bg-ok/10 text-ok"}`} data-testid="member-status">
              {membership.cancelEffective ? "Ending" : membership.status === "past_due" ? "Payment failed" : membership.status === "pending" ? "Starting" : "Active"}
            </span>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Plan</dt><dd>{money(MEMBERSHIP.priceCents)} / month</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Member since</dt><dd>{new Date(membership.startedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</dd></div>
            {membership.chargedThrough && !membership.cancelEffective && <div className="flex justify-between"><dt className="text-muted">Next bill</dt><dd>{fmtDate(membership.chargedThrough)}</dd></div>}
            {membership.cancelEffective && <div className="flex justify-between"><dt className="text-muted">Ends</dt><dd>{fmtDate(membership.cancelEffective)}</dd></div>}
            {me?.card && <div className="flex justify-between"><dt className="text-muted">Card</dt><dd data-testid="member-card">{cardName(me.card.brand)} •••• {me.card.last4}</dd></div>}
          </dl>
          {membership.status === "past_due" && <p className="mt-3 rounded-xl bg-bad/10 p-3 text-sm text-bad">Your last payment didn&apos;t go through. Update your card to keep your perks.</p>}

          {editingCard ? (
            <div className="mt-5 space-y-3">
              <SquareCard ref={cardRef} {...square} />
              <div className="flex gap-3">
                <button type="button" className="btn-ghost flex-1" onClick={() => setEditingCard(false)}>Keep current</button>
                <button type="button" className="btn-primary flex-1" disabled={busy} onClick={updateCard} data-testid="save-card">{busy ? "Saving…" : "Save card"}</button>
              </div>
            </div>
          ) : (
            !membership.cancelEffective && (
              <div className="mt-5 grid gap-3">
                <button type="button" className="btn-ghost" onClick={() => { setEditingCard(true); setNotice(null); }} data-testid="update-card">Update card</button>
                {confirmCancel ? (
                  <div className="rounded-xl border border-bad/30 p-4 text-sm">
                    <p>Cancel your membership? You keep your perks until the end of this billing period.</p>
                    <div className="mt-3 flex gap-3">
                      <button type="button" className="btn-ghost flex-1" onClick={() => setConfirmCancel(false)}>Keep it</button>
                      <button type="button" className="btn-primary flex-1 bg-bad hover:bg-bad/90" disabled={busy} onClick={cancel} data-testid="confirm-cancel">{busy ? "Canceling…" : "Yes, cancel"}</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="min-h-11 text-sm text-muted underline underline-offset-2" onClick={() => setConfirmCancel(true)} data-testid="cancel">Cancel membership</button>
                )}
              </div>
            )
          )}
        </section>
      ) : (
        <section className="card p-5" data-testid="subscribe">
          <h2 className="font-display text-2xl text-forest">Join today</h2>
          <p className="mt-1 text-sm text-muted">Your card is saved securely with Square and billed {money(MEMBERSHIP.priceCents)} today, then monthly.</p>
          <div className="mt-5 space-y-4">
            <Field label="Full name"><input className="input" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" /></Field>
            <Field label="Email"><input className="input" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" /></Field>
            <Field label="Mobile"><input className="input" type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" inputMode="tel" aria-invalid={phoneShowsError(contact.phone)} aria-describedby="phone-err" /></Field>
            <PhoneError phone={contact.phone} />
            <SquareCard ref={cardRef} {...square} />
            <button type="button" className="btn-primary w-full" disabled={busy || !contactValid} onClick={subscribe} data-testid="subscribe-btn">
              {busy ? "Starting membership…" : `Subscribe · ${money(MEMBERSHIP.priceCents)}/month`}
            </button>
          </div>
        </section>
      )}
      {error && <p role="alert" className="mt-4 rounded-xl bg-bad/10 p-3 text-sm text-bad" data-testid="member-error">{error}</p>}
    </div>
  );
}
