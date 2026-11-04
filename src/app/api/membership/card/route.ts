import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { updateMembershipCard } from "@/lib/memberships";
import { getCustomerSession } from "@/lib/session";

const body = z.object({ token: z.string().min(10).max(500), postalCode: z.string().max(10).optional(), idempotencyKey: z.string().uuid() });

export async function POST(req: Request) {
  try {
    const id = await getCustomerSession();
    if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const input = body.parse(await req.json());
    const card = await updateMembershipCard(id, input.token, input.idempotencyKey, input.postalCode);
    return NextResponse.json({ card: { brand: card.card_brand, last4: card.last_4 } });
  } catch (e) {
    return jsonError(e);
  }
}
