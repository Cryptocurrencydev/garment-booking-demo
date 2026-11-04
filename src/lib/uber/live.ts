import { randomUUID } from "node:crypto";
import type { Address, Delivery, DeliveryInput, Quote, QuoteInput, UberDirect, UberStatus } from "./types";
import { UberError } from "./types";

/**
 * Real Uber Direct client (sandbox or production — same endpoints, credentials decide).
 * Docs: https://developer.uber.com/docs/deliveries/direct/api-reference
 */
const AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const API = "https://api.uber.com/v1";

let token: { value: string; exp: number } | null = null;

function uberAddress(a: Address) {
  // Uber expects the structured address as a JSON *string*.
  return JSON.stringify({
    street_address: [a.line1, a.line2].filter(Boolean),
    city: a.city,
    state: a.state,
    zip_code: a.zip,
    country: a.country ?? "US",
  });
}

export class LiveUberDirect implements UberDirect {
  readonly mode = "uber-direct" as const;

  constructor(
    private creds: { customerId: string; clientId: string; clientSecret: string },
  ) {}

  private async accessToken() {
    if (token && token.exp > Date.now() + 60_000) return token.value;
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        grant_type: "client_credentials",
        scope: "eats.deliveries",
      }),
    });
    const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) throw new UberError(`Uber auth failed: ${j.error ?? res.status}`, "auth_failed", 502);
    token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 2_592_000) * 1000 };
    return token.value;
  }

  private async call<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
    const res = await fetch(`${API}/customers/${this.creds.customerId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { code?: string; message?: string } & T;
    if (!res.ok) throw new UberError(j.message ?? `Uber ${path} ${res.status}`, j.code ?? `http_${res.status}`, res.status);
    return j;
  }

  private windowFields(i: QuoteInput) {
    return {
      pickup_ready_dt: i.pickupReadyAt?.toISOString(),
      pickup_deadline_dt: i.pickupDeadlineAt?.toISOString(),
      dropoff_ready_dt: i.dropoffReadyAt?.toISOString(),
      dropoff_deadline_dt: i.dropoffDeadlineAt?.toISOString(),
    };
  }

  async createQuote(i: QuoteInput): Promise<Quote> {
    const j = await this.call<{ id: string; fee: number; currency: string; duration: number; dropoff_eta: string; expires: string }>(
      "/delivery_quotes",
      {
        pickup_address: uberAddress(i.pickup),
        dropoff_address: uberAddress(i.dropoff),
        pickup_latitude: i.pickup.lat,
        pickup_longitude: i.pickup.lon,
        dropoff_latitude: i.dropoff.lat,
        dropoff_longitude: i.dropoff.lon,
        manifest_total_value: i.manifestValueCents,
        external_store_id: "main",
        ...this.windowFields(i),
      },
    );
    return {
      providerQuoteId: j.id,
      feeCents: j.fee,
      currency: j.currency,
      etaMinutes: j.duration,
      dropoffEta: new Date(j.dropoff_eta),
      expiresAt: new Date(j.expires),
    };
  }

  async createDelivery(i: DeliveryInput): Promise<Delivery> {
    const j = await this.call<{ id: string; status: UberStatus; tracking_url: string; fee: number; courier?: Delivery["courier"] }>(
      "/deliveries",
      {
        quote_id: i.quoteId,
        external_id: i.externalId,
        idempotency_key: i.idempotencyKey ?? randomUUID(),
        pickup_name: i.pickupStop.name,
        pickup_address: uberAddress(i.pickup),
        pickup_phone_number: i.pickupStop.phone,
        pickup_latitude: i.pickup.lat,
        pickup_longitude: i.pickup.lon,
        pickup_notes: i.pickupStop.notes,
        dropoff_name: i.dropoffStop.name,
        dropoff_address: uberAddress(i.dropoff),
        dropoff_phone_number: i.dropoffStop.phone,
        dropoff_latitude: i.dropoff.lat,
        dropoff_longitude: i.dropoff.lon,
        dropoff_notes: i.dropoffStop.notes,
        manifest_items: i.manifest.map((m) => ({ name: m.name, quantity: m.quantity, size: "medium" })),
        manifest_total_value: i.manifestValueCents,
        ...this.windowFields(i),
      },
    );
    return { id: j.id, status: j.status, trackingUrl: j.tracking_url, feeCents: j.fee, courier: j.courier ?? null };
  }

  async cancelDelivery(id: string) {
    await this.call(`/deliveries/${id}/cancel`, {});
  }
}
