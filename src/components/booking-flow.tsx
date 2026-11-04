"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { MEMBERSHIP, SERVICES, money } from "@/lib/config";
import { PHONE_HINT, isValidUsPhone } from "@/lib/phone";
import { SquareCard, type SquareCardHandle } from "./square-card";

type Kind = "pickup" | "delivery";
type Win = { start: string; end: string; dayLabel: string; label: string };
type Addr = { line1: string; city: string; state: string; zip: string; lat: number; lon: number; label: string; exact?: boolean };
type Quote = { quoteId: string; feeCents: number; etaMinutes: number; distanceMiles: number | null; mode: string; memberFree: boolean; windowStart: string | null };
export type Me = { name: string; email: string; phone: string; card: { brand: string | null; last4: string | null } | null; member: boolean } | null;

const STEPS = ["Address", "Time", "Garments", "Details", "Pay"];

function uuid() {
  return crypto.randomUUID();
}

export function BookingFlow({ kind, windows, square, me }: { kind: Kind; windows: Win[]; square: { appId: string; locationId: string; env: string }; me: Me }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState<Addr | null>(null);
  const [unit, setUnit] = useState("");
  const [instructions, setInstructions] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [windowStart, setWindowStart] = useState<string | null>(null);
  const [day, setDay] = useState(windows[0]?.dayLabel ?? "");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [ticket, setTicket] = useState("");
  const [contact, setContact] = useState({ name: me?.name ?? "", email: me?.email ?? "", phone: me?.phone ?? "" });
  const [useSaved, setUseSaved] = useState(Boolean(me?.card));
  const [saveCard, setSaveCard] = useState(true);
  const [idem, setIdem] = useState(uuid);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeChange, setFeeChange] = useState<{ quoteId: string; feeCents: number } | null>(null);
  const cardRef = useRef<SquareCardHandle>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const member = Boolean(me?.member || quote?.memberFree);

  async function fetchQuote(a: Addr, w: string | null) {
    setQuoting(true);
    setQuoteError(null);
    try {
      const r = await fetch("/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, address: a, windowStart: w }) });
      const j = await r.json();
      if (!r.ok || j.ok === false) {
        setQuote(null);
        setQuoteError(j.error ?? "Couldn't price a courier for this address.");
        return;
      }
      setQuote({ ...j, windowStart: w });
    } catch {
      setQuoteError("Couldn't reach the courier service. Check your connection.");
    } finally {
      setQuoting(false);
    }
  }

  function pickAddress(a: Addr | null) {
    setAddress(a);
    setQuote(null);
    if (a) fetchQuote(a, windowStart);
  }

  function pickWindow(w: string) {
    setWindowStart(w);
    if (address) fetchQuote(address, w);
  }

  const lines = SERVICES.filter((s) => (qty[s.id] ?? 0) > 0).map((s) => ({ ...s, qty: qty[s.id] }));
  const serviceCents = lines.reduce((a, l) => a + l.qty * l.unitCents, 0);
  const discountCents = member ? Math.round((serviceCents * MEMBERSHIP.discountPct) / 100) : 0;
  const feeCents = quote?.feeCents ?? 0;
  const chargedFee = member ? 0 : feeCents;
  const total = serviceCents - discountCents + chargedFee;

  const contactValid = contact.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(contact.email.trim()) && isValidUsPhone(contact.phone);
  const canContinue = [
    Boolean(address && quote && !quoting),
    Boolean(windowStart && quote?.windowStart === windowStart && !quoting),
    lines.length > 0,
    contactValid,
    !paying,
  ][step];

  function go(n: number) {
    setStep(n);
    setError(null);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function pay(accept?: { quoteId: string; feeCents: number }) {
    if (!quote || !address || !windowStart) return;
    setPaying(true);
    setError(null);
    try {
      let payment: Record<string, unknown>;
      if (useSaved && me?.card) payment = { useSavedCard: true };
      else {
        const t = await cardRef.current!.tokenize();
        payment = { token: t.token, postalCode: t.postalCode, saveCard };
      }
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          quoteId: accept?.quoteId ?? quote.quoteId,
          acceptFee: accept?.feeCents,
          address: { line1: address.line1, city: address.city, state: address.state, zip: address.zip, lat: address.lat, lon: address.lon, label: address.label },
          unit: unit || null,
          instructions: instructions || null,
          windowStart,
          items: lines.map((l) => ({ id: l.id, qty: l.qty })),
          notes: notes || null,
          ticketNumber: ticket || null,
          contact,
          payment,
          idempotencyKey: idem,
        }),
      });
      const j = await r.json();
      if (r.ok && j.ok !== false) {
        router.push(`/confirmation/${j.ref}`);
        return;
      }
      if (j.code === "fee_changed") {
        setFeeChange({ quoteId: j.quoteId, feeCents: j.feeCents });
        setQuote((q) => (q ? { ...q, quoteId: j.quoteId, feeCents: j.feeCents, etaMinutes: j.etaMinutes } : q));
        setPaying(false);
        return;
      }
      setError(j.error ?? "Payment failed. Please try again.");
      if (j.code === "payment_failed" || j.code === "attempt_used" || j.code === "no_saved_card") setIdem(uuid());
      if (j.code === "no_saved_card") setUseSaved(false);
      setPaying(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed. Please try again.");
      setPaying(false);
    }
  }

  const days = useMemo(() => [...new Set(windows.map((w) => w.dayLabel))], [windows]);
  const verb = kind === "pickup" ? "pickup" : "delivery";

  return (
    <div ref={topRef} className="mx-auto max-w-lg scroll-mt-16 px-4 pb-40">
      <div className="pt-6">
        <p className="text-xs font-medium tracking-[0.2em] text-brass uppercase">{kind === "pickup" ? "Schedule a pickup" : "Schedule a delivery"}</p>
        <h1 className="mt-1 font-display text-3xl text-forest">
          {["Where should we " + (kind === "pickup" ? "collect?" : "deliver?"), "Choose a window", kind === "pickup" ? "What are we collecting?" : "What's coming home?", "Your details", "Review & pay"][step]}
        </h1>
        <ol className="mt-4 flex gap-1.5" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <button
                type="button"
                disabled={i > step}
                onClick={() => go(i)}
                className={`h-1.5 w-full rounded-full ${i <= step ? "bg-forest" : "bg-line"} disabled:cursor-default`}
                aria-label={`${s}${i === step ? " (current step)" : i < step ? " (done)" : ""}`}
                aria-current={i === step ? "step" : undefined}
              />
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-faint">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
      </div>

      <div className="mt-6 fade-in" key={step}>
        {step === 0 && (
          <div className="space-y-4">
            <AddressSearch value={address} onPick={pickAddress} />
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <Field label="Apt / unit">
                <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={60} className="input" autoComplete="address-line2" />
              </Field>
              <Field label="Courier instructions">
                <input value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={300} placeholder="Gate code, doorman…" className="input" />
              </Field>
            </div>
            <QuoteCard quote={quote} quoting={quoting} error={quoteError} member={member} kind={kind} />
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Day">
              {days.map((d) => (
                <button key={d} type="button" role="tab" aria-selected={d === day} onClick={() => setDay(d)} className={`min-h-11 shrink-0 rounded-full border px-4 text-sm ${d === day ? "border-forest bg-forest text-paper" : "border-line bg-paper"}`}>
                  {d}
                </button>
              ))}
            </div>
            <fieldset className="mt-4">
              <legend className="sr-only">Time window on {day}</legend>
              <div className="grid grid-cols-2 gap-2">
                {windows
                  .filter((w) => w.dayLabel === day)
                  .map((w) => (
                    <label key={w.start} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brass ${windowStart === w.start ? "border-forest bg-forest/5 font-medium text-forest" : "border-line bg-paper"}`}>
                      <input type="radio" name="window" className="sr-only" checked={windowStart === w.start} onChange={() => pickWindow(w.start)} />
                      {w.label}
                    </label>
                  ))}
              </div>
            </fieldset>
            <div className="mt-5">
              <QuoteCard quote={windowStart ? quote : null} quoting={quoting} error={quoteError} member={member} kind={kind} hint={!windowStart ? "Pick a window to confirm the courier price for that time." : undefined} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            {kind === "delivery" && (
              <Field label="Ticket number (from your receipt)" hint="Optional — helps us bag the right order.">
                <input value={ticket} onChange={(e) => setTicket(e.target.value)} maxLength={40} className="input" inputMode="text" placeholder="e.g. 4821" />
              </Field>
            )}
            <ul className="divide-y divide-line rounded-2xl border border-line bg-paper">
              {SERVICES.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex-1">
                    <span className="block text-sm">{s.name}</span>
                    <span className="text-xs text-faint tabular">{money(s.unitCents)} each</span>
                  </span>
                  <Stepper label={s.name} value={qty[s.id] ?? 0} onChange={(v) => setQty((q) => ({ ...q, [s.id]: v }))} />
                </li>
              ))}
            </ul>
            <Field label="Notes for the atelier" hint="Stains, starch preference, repairs…">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3} className="input min-h-24 py-3" />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Field label="Full name">
              <input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} className="input" autoComplete="name" />
            </Field>
            <Field label="Email" hint="Your confirmation goes here.">
              <input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} className="input" type="email" autoComplete="email" inputMode="email" />
            </Field>
            <Field label="Mobile" hint="For courier updates by text.">
              <input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} className="input" type="tel" autoComplete="tel" inputMode="tel" placeholder="(973) 555-0100" aria-invalid={phoneShowsError(contact.phone)} aria-describedby="phone-err" />
            </Field>
            <PhoneError phone={contact.phone} />
          </div>
        )}

        {step === 4 && quote && address && windowStart && (
          <div className="space-y-5">
            <dl className="rounded-2xl border border-line bg-paper p-4 text-sm">
              <Row k={kind === "pickup" ? "Collect from" : "Deliver to"} v={`${address.line1}${unit ? `, ${unit}` : ""}, ${address.city}`} />
              <Row k="Window" v={(() => { const w = windows.find((x) => x.start === windowStart); return w ? `${w.dayLabel}, ${w.label}` : ""; })()} />
              <Row k="Garments" v={lines.map((l) => `${l.qty}× ${l.name}`).join(", ")} />
              <div className="my-3 border-t border-line" />
              <Row k="Service estimate" v={money(serviceCents)} num />
              {discountCents > 0 && <Row k={`Member ${MEMBERSHIP.discountPct}% off`} v={`−${money(discountCents)}`} num />}
              <Row k="Uber courier" v={member ? <span><s className="text-faint">{money(feeCents)}</s> <span className="text-ok">Free</span></span> : money(feeCents)} num />
              <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
                <dt className="font-medium">Total today</dt>
                <dd className="font-display text-2xl text-forest tabular" data-testid="total">{money(total)}</dd>
              </div>
              <p className="mt-2 text-xs text-faint">Estimate based on your list; any difference after inspection is settled when your garments come back.</p>
            </dl>

            {feeChange && (
              <div role="alert" className="rounded-xl border border-brass bg-brass-soft p-4 text-sm">
                <p>The Uber fee for this window is now <strong>{money(feeChange.feeCents)}</strong>.</p>
                <button type="button" onClick={() => { const fc = feeChange; setFeeChange(null); pay(fc); }} className="btn-primary mt-3 w-full">
                  Accept and pay {money(serviceCents - discountCents + (member ? 0 : feeChange.feeCents))}
                </button>
              </div>
            )}

            {me?.card && (
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Payment</legend>
                <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 ${useSaved ? "border-forest bg-forest/5" : "border-line bg-paper"}`}>
                  <input type="radio" name="pm" checked={useSaved} onChange={() => setUseSaved(true)} className="accent-forest" />
                  <span className="text-sm">
                    {cardName(me.card.brand)} •••• {me.card.last4} <span className="text-faint">· saved</span>
                  </span>
                </label>
                <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 ${!useSaved ? "border-forest bg-forest/5" : "border-line bg-paper"}`}>
                  <input type="radio" name="pm" checked={!useSaved} onChange={() => setUseSaved(false)} className="accent-forest" />
                  <span className="text-sm">Use a different card</span>
                </label>
              </fieldset>
            )}

            {(!me?.card || !useSaved) && (
              <div className="space-y-3">
                {!me?.card && <p className="text-sm font-medium">Card</p>}
                <SquareCard ref={cardRef} {...square} />
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} className="size-4 accent-forest" />
                  Save this card for one-tap checkout next time
                </label>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-xl bg-bad/10 p-3 text-sm text-bad" data-testid="pay-error">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)} className="btn-ghost" aria-label="Back">
              Back
            </button>
          )}
          <div className="flex-1 text-sm leading-tight">
            {quote && (
              <>
                <span className="block text-xs text-faint">{step < 2 ? "Uber courier" : "Total"}</span>
                <span className="font-medium tabular">{step < 2 ? (member ? "Free for members" : money(feeCents)) : money(total)}</span>
              </>
            )}
          </div>
          {step < 4 ? (
            <button type="button" disabled={!canContinue} onClick={() => go(step + 1)} className="btn-primary">
              Continue
            </button>
          ) : (
            <button type="button" disabled={paying || Boolean(feeChange)} onClick={() => pay()} className="btn-primary" data-testid="pay">
              {paying ? "Processing…" : useSaved && me?.card ? `Pay ${money(total)} · ${cardName(me.card.brand)} ${me.card.last4}` : `Pay ${money(total)}`}
            </button>
          )}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{quoting ? `Getting Uber ${verb} price` : ""}</p>
    </div>
  );
}

export function phoneShowsError(phone: string) {
  return phone.replace(/\D/g, "").length >= 10 && !isValidUsPhone(phone);
}

export function PhoneError({ phone }: { phone: string }) {
  return (
    <p id="phone-err" role={phoneShowsError(phone) ? "alert" : undefined} className="-mt-2 min-h-0 text-sm text-bad" data-testid="phone-error">
      {phoneShowsError(phone) ? PHONE_HINT : ""}
    </p>
  );
}

export function cardName(brand: string | null) {
  if (!brand) return "Card";
  const b = brand.replace(/_/g, " ").toLowerCase();
  if (b.includes("visa")) return "Visa";
  if (b.includes("mastercard")) return "Mastercard";
  if (b.includes("american")) return "Amex";
  if (b.includes("discover")) return "Discover";
  return b.replace(/\b\w/g, (c) => c.toUpperCase());
}

function Row({ k, v, num }: { k: string; v: React.ReactNode; num?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-muted">{k}</dt>
      <dd className={`text-right ${num ? "tabular" : ""}`}>{v}</dd>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label={`Remove one ${label}`} disabled={value === 0} onClick={() => onChange(Math.max(0, value - 1))} className="grid size-11 place-items-center rounded-full border border-line text-lg disabled:opacity-30">
        −
      </button>
      <span className="w-6 text-center tabular" aria-live="polite" aria-label={`${value} ${label}`}>
        {value}
      </span>
      <button type="button" aria-label={`Add one ${label}`} disabled={value >= 50} onClick={() => onChange(value + 1)} className="grid size-11 place-items-center rounded-full border border-line text-lg">
        +
      </button>
    </div>
  );
}

function QuoteCard({ quote, quoting, error, member, kind, hint }: { quote: Quote | null; quoting: boolean; error: string | null; member: boolean; kind: Kind; hint?: string }) {
  if (error) return <p role="alert" className="rounded-2xl border border-bad/30 bg-bad/5 p-4 text-sm text-bad">{error}</p>;
  if (quoting)
    return (
      <div className="rounded-2xl border border-line bg-paper p-4 text-sm text-muted" data-testid="quote-loading">
        Getting a live Uber courier price…
      </div>
    );
  if (!quote) return hint ? <p className="text-sm text-faint">{hint}</p> : null;
  return (
    <div className="rounded-2xl border border-forest/20 bg-forest/5 p-4" data-testid="quote">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-forest uppercase">Uber courier {kind === "pickup" ? "to our atelier" : "to your door"}</p>
          <p className="mt-1 font-display text-3xl text-forest tabular" data-testid="quote-fee">
            {member ? <><s className="text-xl text-faint">{money(quote.feeCents)}</s> Free</> : money(quote.feeCents)}
          </p>
        </div>
        <span className="rounded-full bg-paper px-2.5 py-1 text-[11px] text-muted">{quote.mode === "uber-direct" ? "Uber Direct sandbox" : "Sandbox pending · simulated"}</span>
      </div>
      <p className="mt-2 text-sm text-muted" data-testid="quote-eta">
        ~{quote.etaMinutes} min door to door{quote.distanceMiles ? ` · ${quote.distanceMiles.toFixed(1)} mi` : ""}
        {quote.windowStart ? " · priced for your window" : " · next available courier"}
      </p>
    </div>
  );
}

function AddressSearch({ value, onPick }: { value: Addr | null; onPick: (a: Addr | null) => void }) {
  const id = useId();
  const [text, setText] = useState(value?.label ?? "");
  const [results, setResults] = useState<Addr[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const seq = useRef(0);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function search(raw: string) {
    if (timer.current) clearTimeout(timer.current);
    const q = raw.trim();
    const n = ++seq.current;
    if (q.length < 4) {
      setResults([]);
      setLoading(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/address?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (n !== seq.current) return;
        setResults(j.results ?? []);
        setMsg(j.error ?? (j.results?.length ? null : "No matching street address yet — include the house number."));
        setOpen(true);
        setActive(-1);
      } catch {
        if (n === seq.current) setMsg("Address lookup is unavailable right now.");
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 280);
  }

  function choose(a: Addr) {
    seq.current++;
    setText(a.label);
    setOpen(false);
    setResults([]);
    onPick(a);
  }

  return (
    <div className="relative">
      <label htmlFor={`${id}-in`} className="mb-1.5 block text-sm font-medium">
        Street address
      </label>
      <input
        id={`${id}-in`}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        className="input"
        placeholder="Start typing, e.g. 12 Valley Rd, Montclair"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          search(e.target.value);
          if (value) onPick(null);
        }}
        onKeyDown={(e) => {
          if (!open || !results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? results.length - 1 : a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => results.length && setOpen(true)}
        data-testid="address-input"
      />
      {loading && <span className="absolute top-[2.65rem] right-3 text-xs text-faint">Searching…</span>}
      {open && results.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute inset-x-0 z-20 mt-1 overflow-hidden rounded-xl border border-line bg-paper shadow-lg">
          {results.map((r, i) => (
            <li
              key={r.label}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              className={`cursor-pointer px-4 py-3 text-sm ${i === active ? "bg-brass-soft" : ""}`}
            >
              <span className="block">{r.line1}</span>
              <span className="text-xs text-faint">
                {r.city}, {r.state} {r.zip}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!open && msg && !value && text.length >= 4 && <p className="mt-1 text-xs text-faint">{msg}</p>}
      <p className="mt-1 text-[11px] text-faint">Address search © OpenStreetMap contributors</p>
    </div>
  );
}
