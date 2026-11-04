import { NextResponse } from "next/server";
import { z } from "zod";
import { CheckoutError } from "./bookings";
import { UberError } from "./uber/types";

export const addressSchema = z.object({
  line1: z.string().min(3).max(200),
  line2: z.string().max(100).nullish(),
  city: z.string().min(1).max(100),
  state: z.string().min(2).max(30),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/),
  country: z.string().optional(),
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  label: z.string().max(300).optional(),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().regex(/^[+()\d\s.-]{10,20}$/, "Enter a valid phone number"),
});

export function jsonError(e: unknown) {
  if (e instanceof z.ZodError) {
    return NextResponse.json({ error: "Please check the highlighted details.", code: "invalid", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  if (e instanceof CheckoutError) {
    if (e.extra.squareCode) console.warn(`[square] ${e.code}: ${String(e.extra.squareCode)}`);
    // Expected business outcomes (decline, fee changed, out of area) are 200 + ok:false so browsers don't log them as errors.
    return NextResponse.json({ ok: false, error: e.message, code: e.code, httpStatus: e.status, ...e.extra }, { status: e.status >= 500 ? e.status : 200 });
  }
  if (e instanceof UberError) {
    const msg = e.code === "address_undeliverable" ? "Sorry — that address is outside our courier area." : "Couldn't get a courier price right now. Please try again.";
    return NextResponse.json({ ok: false, error: msg, code: e.code }, { status: e.status >= 500 ? 502 : 200 });
  }
  console.error(e);
  return NextResponse.json({ error: "Something went wrong. Please try again.", code: "server_error" }, { status: 500 });
}
