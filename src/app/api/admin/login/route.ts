import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/security";
import { adminPassword, setAdminSession } from "@/lib/session";

export async function POST(req: Request) {
  const form = await req.formData();
  const pw = String(form.get("password") ?? "");
  const expected = adminPassword();
  const url = new URL("/admin", req.url);
  if (!expected || !safeEqual(pw, expected)) {
    url.searchParams.set("error", "1");
    return NextResponse.redirect(url, 303);
  }
  await setAdminSession();
  return NextResponse.redirect(url, 303);
}
