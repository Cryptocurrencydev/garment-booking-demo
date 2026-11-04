import { NextResponse } from "next/server";
import { handleSquareWebhook } from "@/lib/memberships";

/** Square webhooks: invoice.payment_made, invoice.scheduled_charge_failed, subscription.*, payment.* */
export async function POST(req: Request) {
  const raw = await req.text();
  const r = await handleSquareWebhook(raw, req.headers.get("x-square-hmacsha256-signature"));
  return NextResponse.json(r, { status: r.status });
}
