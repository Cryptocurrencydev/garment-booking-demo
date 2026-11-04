import { NextResponse } from "next/server";
import { handleUberWebhook } from "@/lib/bookings";

/** Uber Direct delivery status webhooks (courier assigned, picked up, delivered, canceled). */
export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-uber-signature") ?? req.headers.get("x-postmates-signature");
  const r = await handleUberWebhook(raw, sig);
  return NextResponse.json(r, { status: r.status });
}
