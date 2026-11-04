import { pool, q } from "@/lib/db";
import type { Address } from "@/lib/uber";

export const NEAR: Address & { label: string } = {
  line1: "12 Valley Place",
  city: "Montclair",
  state: "NJ",
  zip: "07043",
  lat: 40.8474202,
  lon: -74.206634,
  label: "12 Valley Place, Montclair, NJ 07043",
};

export const FAR: Address = { line1: "1 Main St", city: "Princeton", state: "NJ", zip: "08540", lat: 40.3573, lon: -74.6672 };

export async function resetDb() {
  await q("truncate notifications, webhook_events, payments, delivery_events, memberships, bookings, quotes, customers, settings restart identity cascade");
}

export function uniqueEmail(tag: string) {
  // Square deactivates subscriptions for customers with undeliverable emails (e.g. @example.com), so use a real domain.
  return `marlowe.finch.demo+${tag}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@gmail.com`;
}

export async function closeDb() {
  await pool().end();
  globalThis.__mfPool = undefined;
}
