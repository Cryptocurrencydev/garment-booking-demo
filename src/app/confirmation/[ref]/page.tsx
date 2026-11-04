import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SandboxBanner, SiteFooter, SiteHeader } from "@/components/chrome";
import { Tracker } from "@/components/tracker";
import { advanceMockDeliveries, deliveryEvents, getBookingByRef, statusLabel } from "@/lib/bookings";
import { MEMBERSHIP, money } from "@/lib/config";
import { q } from "@/lib/db";
import { formatWhen } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking confirmed" };

export default async function Confirmation({ params }: PageProps<"/confirmation/[ref]">) {
  const { ref } = await params;
  await advanceMockDeliveries(ref);
  const b = await getBookingByRef(ref);
  if (!b) notFound();
  const events = await deliveryEvents(b.id);
  const emails = await q<{ subject: string; body_html: string; to_addr: string; provider: string; status: string }>(
    "select subject, body_html, to_addr, provider, status from notifications where booking_id=$1 and channel='email' and audience='customer' order by id limit 1",
    [b.id],
  );
  const email = emails[0];
  const initial = {
    status: b.status,
    uberStatus: b.uber_status,
    label: statusLabel(b.kind, b.uber_status ?? "pending", b.courier),
    courier: b.courier ? { name: b.courier.name, vehicle: b.courier.vehicle_type, rating: b.courier.rating } : null,
    events: events.map((e) => ({ status: e.status, detail: e.detail, at: e.at.toISOString() })),
  };
  return (
    <>
      <SandboxBanner />
      <SiteHeader back={{ href: "/", label: "Home" }} />
      <main className="mx-auto max-w-lg px-4 pt-8">
        <div className="grid size-14 place-items-center rounded-full bg-forest text-paper">
          <svg aria-hidden width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12l5 5L20 7" /></svg>
        </div>
        <h1 className="mt-4 font-display text-3xl text-forest">{b.kind === "pickup" ? "Pickup booked" : "Delivery booked"}</h1>
        <p className="mt-1 text-muted">
          Thank you, {b.name.split(" ")[0]}. Confirmation sent to {b.email}.
        </p>
        <p className="mt-3 inline-block rounded-full bg-brass-soft px-3 py-1 text-sm tabular" data-testid="booking-ref">
          {b.ref}
        </p>

        <section className="card mt-6 p-5">
          <h2 className="text-xs font-medium tracking-wide text-faint uppercase">Courier status</h2>
          <div className="mt-2">
            <Tracker refCode={b.ref} kind={b.kind} initial={initial} />
          </div>
          {b.uber_tracking_url && (
            <a href={b.uber_tracking_url} className="btn-ghost mt-5 w-full" target={b.uber_mode === "uber-direct" ? "_blank" : undefined} rel="noopener">
              {b.uber_mode === "uber-direct" ? "Open Uber live tracking" : "Tracking page (simulated)"}
            </a>
          )}
          {b.uber_mode !== "uber-direct" && <p className="mt-2 text-xs text-faint">Uber Direct sandbox pending: this courier is simulated and progresses over ~5 minutes.</p>}
        </section>

        <section className="card mt-4 p-5 text-sm">
          <dl className="space-y-2">
            <div className="flex justify-between gap-4"><dt className="text-muted">Window</dt><dd className="text-right">{formatWhen(b.window_start, b.window_end)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">{b.kind === "pickup" ? "From" : "To"}</dt><dd className="text-right">{b.address.line1}{b.unit ? `, ${b.unit}` : ""}, {b.address.city}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted">Garments</dt><dd className="text-right">{b.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</dd></div>
            <div className="border-t border-line pt-2 flex justify-between"><dt className="text-muted">Service estimate</dt><dd className="tabular">{money(b.service_cents)}</dd></div>
            {b.discount_cents > 0 && <div className="flex justify-between"><dt className="text-muted">Member {MEMBERSHIP.discountPct}% off</dt><dd className="tabular">−{money(b.discount_cents)}</dd></div>}
            <div className="flex justify-between"><dt className="text-muted">Uber courier</dt><dd className="tabular">{b.delivery_fee_waived ? "Free (member)" : money(b.delivery_fee_cents)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>Paid</dt><dd className="tabular" data-testid="paid">{money(b.total_cents)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-faint">
            {b.card_brand ? `${b.card_brand.replace(/_/g, " ")} •••• ${b.card_last4} · ` : ""}Square {b.payment_status?.toLowerCase()}
            {b.square_receipt_url && (
              <>
                {" · "}
                <a className="underline" href={b.square_receipt_url} target="_blank" rel="noopener">Square receipt</a>
              </>
            )}
          </p>
        </section>

        {email && (
          <details className="card mt-4 p-5 text-sm">
            <summary className="cursor-pointer font-medium">Confirmation email {email.provider === "outbox" ? "(demo outbox preview)" : `(sent via ${email.provider})`}</summary>
            <p className="mt-2 text-xs text-faint">To {email.to_addr} · {email.subject}</p>
            <div className="mt-3 overflow-hidden rounded-xl border border-line" dangerouslySetInnerHTML={{ __html: email.body_html.replace(/^[\s\S]*?<body[^>]*>/, "").replace(/<\/body>[\s\S]*$/, "") }} />
          </details>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Link href="/book/pickup" className="btn-ghost">Book another</Link>
          <Link href="/membership" className="btn-primary">Membership</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
