import { NextResponse } from "next/server";
import { dispatch } from "@/lib/bookings";
import { one, q } from "@/lib/db";
import { isAdmin } from "@/lib/session";

/** Owner retries an Uber dispatch that failed after payment. */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await req.formData();
  const ref = String(form.get("ref") ?? "");
  const b = await one<{ id: string; quote_id: string; kind: string; address: unknown; window_start: Date }>("select id, quote_id, kind, address, window_start from bookings where ref=$1 and status='dispatch_failed'", [ref]);
  if (b) {
    await q("update bookings set status='paid' where id=$1", [b.id]);
    await dispatch(b.id);
  }
  return NextResponse.redirect(new URL("/admin", req.url), 303);
}
