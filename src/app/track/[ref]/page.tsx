import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SandboxBanner, SiteFooter, SiteHeader } from "@/components/chrome";
import { Tracker } from "@/components/tracker";
import { advanceMockDeliveries, deliveryEvents, getBookingByRef, statusLabel } from "@/lib/bookings";
import { STORE } from "@/lib/config";
import { formatWhen } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Track your courier" };

/** Tracking page used as the tracking_url while Uber Direct sandbox is pending (Uber hosts its own when live). */
export default async function Track({ params }: PageProps<"/track/[ref]">) {
  const { ref } = await params;
  await advanceMockDeliveries(ref);
  const b = await getBookingByRef(ref);
  if (!b) notFound();
  const events = await deliveryEvents(b.id);
  const from = b.kind === "pickup" ? `${b.address.line1}, ${b.address.city}` : `${STORE.address.line1}, ${STORE.address.city}`;
  const to = b.kind === "pickup" ? `${STORE.address.line1}, ${STORE.address.city}` : `${b.address.line1}, ${b.address.city}`;
  return (
    <>
      <SandboxBanner />
      <SiteHeader back={{ href: `/confirmation/${b.ref}`, label: "Booking" }} />
      <main className="mx-auto max-w-lg px-4 pt-8">
        <p className="text-xs font-medium tracking-[0.2em] text-brass uppercase">Simulated Uber courier · {b.ref}</p>
        <h1 className="mt-1 font-display text-3xl text-forest">Track your courier</h1>
        <p className="mt-1 text-sm text-muted">{formatWhen(b.window_start, b.window_end)}</p>
        <div className="card mt-6 p-5">
          <Tracker
            refCode={b.ref}
            kind={b.kind}
            initial={{
              status: b.status,
              uberStatus: b.uber_status,
              label: statusLabel(b.kind, b.uber_status ?? "pending", b.courier),
              courier: b.courier ? { name: b.courier.name, vehicle: b.courier.vehicle_type, rating: b.courier.rating } : null,
              events: events.map((e) => ({ status: e.status, detail: e.detail, at: e.at.toISOString() })),
            }}
          />
        </div>
        <dl className="card mt-4 space-y-2 p-5 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted">From</dt><dd className="text-right">{from}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">To</dt><dd className="text-right">{to}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted">Uber delivery</dt><dd className="text-right font-mono text-xs break-all">{b.uber_delivery_id}</dd></div>
        </dl>
      </main>
      <SiteFooter />
    </>
  );
}
