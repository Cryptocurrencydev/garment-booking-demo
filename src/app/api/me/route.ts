import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { currentMembership } from "@/lib/memberships";
import { clearCustomerSession, getCustomerSession } from "@/lib/session";

export async function GET() {
  const id = await getCustomerSession();
  if (!id) return NextResponse.json({ customer: null });
  const c = await one<{ name: string; email: string; phone: string; card_brand: string | null; card_last4: string | null; card_exp: string | null; square_card_id: string | null }>(
    "select name, email, phone, card_brand, card_last4, card_exp, square_card_id from customers where id=$1",
    [id],
  );
  if (!c) return NextResponse.json({ customer: null });
  const m = await currentMembership(id);
  return NextResponse.json({
    customer: { name: c.name, email: c.email, phone: c.phone, card: c.square_card_id ? { brand: c.card_brand, last4: c.card_last4, exp: c.card_exp } : null },
    membership: m ? { status: m.status, chargedThrough: m.charged_through, cancelEffective: m.cancel_effective, startedAt: m.started_at } : null,
  });
}

export async function DELETE() {
  await clearCustomerSession();
  return NextResponse.json({ ok: true });
}
