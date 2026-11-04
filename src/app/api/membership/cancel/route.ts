import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { cancelMembership } from "@/lib/memberships";
import { getCustomerSession } from "@/lib/session";

export async function POST() {
  try {
    const id = await getCustomerSession();
    if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const m = await cancelMembership(id);
    return NextResponse.json({ status: m.status, cancelEffective: m.cancel_effective });
  } catch (e) {
    return jsonError(e);
  }
}
