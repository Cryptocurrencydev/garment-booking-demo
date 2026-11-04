import { NextResponse } from "next/server";
import { z } from "zod";
import { checkout } from "@/lib/bookings";
import { addressSchema, contactSchema, jsonError } from "@/lib/api";
import { getCustomerSession, setCustomerSession } from "@/lib/session";

const body = z.object({
  kind: z.enum(["pickup", "delivery"]),
  quoteId: z.string().uuid(),
  address: addressSchema,
  unit: z.string().max(60).nullish(),
  instructions: z.string().max(300).nullish(),
  windowStart: z.string().datetime(),
  items: z.array(z.object({ id: z.string().max(30), qty: z.number().int().min(0).max(50) })).max(20),
  notes: z.string().max(500).nullish(),
  ticketNumber: z.string().max(40).nullish(),
  contact: contactSchema,
  payment: z.union([
    z.object({ token: z.string().min(10).max(500), saveCard: z.boolean(), postalCode: z.string().max(10).optional() }),
    z.object({ useSavedCard: z.literal(true) }),
  ]),
  idempotencyKey: z.string().uuid(),
  acceptFee: z.number().int().optional(),
});

export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json());
    const r = await checkout(input, await getCustomerSession());
    if (!("useSavedCard" in input.payment) && input.payment.saveCard) await setCustomerSession(r.booking.customer_id);
    else if ("useSavedCard" in input.payment) await setCustomerSession(r.booking.customer_id);
    return NextResponse.json({ ref: r.booking.ref, status: r.booking.status, replayed: r.replayed });
  } catch (e) {
    return jsonError(e);
  }
}
