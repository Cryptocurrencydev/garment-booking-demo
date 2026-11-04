import { NextResponse } from "next/server";
import { z } from "zod";
import { contactSchema, jsonError } from "@/lib/api";
import { subscribe } from "@/lib/memberships";
import { setCustomerSession } from "@/lib/session";

const body = z.object({ contact: contactSchema, token: z.string().min(10).max(500), postalCode: z.string().max(10).optional(), idempotencyKey: z.string().uuid() });

export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json());
    const r = await subscribe(input);
    await setCustomerSession(r.customer.id);
    return NextResponse.json({ status: r.membership.status, replayed: r.replayed });
  } catch (e) {
    return jsonError(e);
  }
}
