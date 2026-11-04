import { NextResponse } from "next/server";
import { advanceMockDeliveries, deliveryEvents, getBookingByRef, statusLabel } from "@/lib/bookings";

export async function GET(_req: Request, ctx: RouteContext<"/api/track/[ref]">) {
  const { ref } = await ctx.params;
  await advanceMockDeliveries(ref);
  const b = await getBookingByRef(ref);
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const events = await deliveryEvents(b.id);
  return NextResponse.json({
    status: b.status,
    uberStatus: b.uber_status,
    label: statusLabel(b.kind, b.uber_status ?? "pending", b.courier),
    courier: b.courier ? { name: b.courier.name, vehicle: b.courier.vehicle_type, rating: b.courier.rating } : null,
    events: events.map((e) => ({ status: e.status, detail: e.detail, at: e.at })),
  });
}
