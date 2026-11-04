import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function hmacHex(key: string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

export function hmacBase64(key: string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest("base64");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Derive a stable, Square-compatible (<=45 chars) idempotency key for one API call
 * from the client's checkout attempt key. Retries of the same attempt reuse the same key.
 */
export function idemKey(base: string, purpose: string) {
  return createHash("sha256").update(`${base}:${purpose}`).digest("hex").slice(0, 40);
}

export function bookingRef() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `MF-${s}`;
}

export function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) throw new Error("SESSION_SECRET is not set");
  return "dev-only-session-secret-change-me";
}
