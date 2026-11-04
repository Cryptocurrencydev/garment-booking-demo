import "server-only";
import { cookies } from "next/headers";
import { hmacHex, safeEqual, sessionSecret } from "./security";

const CUSTOMER_COOKIE = "mf_customer";
const ADMIN_COOKIE = "mf_admin";

function sign(value: string) {
  return `${value}.${hmacHex(sessionSecret(), value)}`;
}

export function unsign(signed: string | undefined) {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  return safeEqual(signed.slice(i + 1), hmacHex(sessionSecret(), value)) ? value : null;
}

const secure = process.env.NODE_ENV === "production" && !process.env.PLAYWRIGHT_LOCAL;

/** "Remember this device" cookie for one-tap checkout with the card on file. */
export async function setCustomerSession(customerId: string) {
  (await cookies()).set(CUSTOMER_COOKIE, sign(customerId), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}

export async function getCustomerSession() {
  return unsign((await cookies()).get(CUSTOMER_COOKIE)?.value);
}

export async function clearCustomerSession() {
  (await cookies()).delete(CUSTOMER_COOKIE);
}

export async function setAdminSession() {
  const exp = Date.now() + 1000 * 60 * 60 * 12;
  (await cookies()).set(ADMIN_COOKIE, sign(`admin:${exp}`), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function isAdmin() {
  const v = unsign((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!v?.startsWith("admin:")) return false;
  return Number(v.slice(6)) > Date.now();
}

export async function clearAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export function adminPassword() {
  return process.env.ADMIN_PASSWORD || (process.env.VERCEL ? null : "demo-admin");
}
