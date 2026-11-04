import { NextResponse } from "next/server";
import { z } from "zod";
import { createQuote, isActiveMember } from "@/lib/bookings";
import { addressSchema, jsonError } from "@/lib/api";
import { getCustomerSession } from "@/lib/session";

const body = z.object({ kind: z.enum(["pickup", "delivery"]), address: addressSchema, windowStart: z.string().datetime().nullish() });

export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json());
    const quote = await createQuote(input.kind, input.address, input.windowStart);
    const member = await isActiveMember(await getCustomerSession());
    return NextResponse.json({
      quoteId: quote.quoteId,
      mode: quote.mode,
      feeCents: quote.feeCents,
      etaMinutes: quote.etaMinutes,
      dropoffEta: quote.dropoffEta,
      expiresAt: quote.expiresAt,
      distanceMiles: quote.distanceMiles ?? null,
      memberFree: member,
    });
  } catch (e) {
    return jsonError(e);
  }
}
