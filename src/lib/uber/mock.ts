import { createHash, randomUUID } from "node:crypto";
import { STORE } from "../config";
import { roadMiles } from "./geo";
import type { Courier, Delivery, DeliveryInput, Quote, QuoteInput, UberDirect, UberStatus } from "./types";
import { UberError } from "./types";

/**
 * Realistic stand-in for the Uber Direct sandbox ("Uber Direct sandbox pending").
 * Pricing follows the shape of Uber Direct local pricing: a base fee plus a per-mile component,
 * rounded to the cent, with a small evening surcharge. Status then progresses over time and is
 * delivered to our webhook handler as signed events — the same code path the real API uses.
 */
export const MOCK_PRICING = { baseCents: 599, perMileCents: 115, eveningSurchargeCents: 150, minCents: 699 };

/** Compressed demo timeline: seconds after dispatch at which each status is reached. */
export const MOCK_TIMELINE: { status: UberStatus; afterSec: number }[] = [
  { status: "pending", afterSec: 0 },
  { status: "pickup", afterSec: 40 }, // courier assigned, heading to pickup
  { status: "pickup_complete", afterSec: 120 },
  { status: "dropoff", afterSec: 150 },
  { status: "delivered", afterSec: 300 },
];

const COURIERS: Courier[] = [
  { name: "Andre M.", vehicle_type: "car", rating: 4.9 },
  { name: "Priya S.", vehicle_type: "car", rating: 5.0 },
  { name: "Luis R.", vehicle_type: "car", rating: 4.8 },
  { name: "Grace K.", vehicle_type: "car", rating: 4.9 },
];

export function mockCourierFor(id: string): Courier {
  const n = createHash("sha1").update(id).digest()[0] % COURIERS.length;
  return { ...COURIERS[n], phone_number: "+1 (555) 010-0" + String(100 + n).slice(-3) };
}

export function mockFee(input: QuoteInput) {
  const miles = roadMiles(input.pickup, input.dropoff);
  const at = input.pickupReadyAt ?? new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: STORE.timezone, hour: "numeric", hourCycle: "h23" }).format(at));
  let cents = MOCK_PRICING.baseCents + Math.round(miles * MOCK_PRICING.perMileCents);
  if (hour >= 17) cents += MOCK_PRICING.eveningSurchargeCents;
  return { cents: Math.max(cents, MOCK_PRICING.minCents), miles };
}

export class MockUberDirect implements UberDirect {
  readonly mode = "uber-mock" as const;

  constructor(private appUrl: string) {}

  async createQuote(input: QuoteInput): Promise<Quote> {
    const { cents, miles } = mockFee(input);
    if (miles > STORE.maxRadiusMiles * 1.3) {
      throw new UberError("This address is outside our courier area.", "address_undeliverable", 400);
    }
    const start = input.pickupReadyAt && input.pickupReadyAt.getTime() > Date.now() ? input.pickupReadyAt : new Date();
    const courierArrives = 9 + Math.round(miles * 0.6);
    const travel = Math.round(6 + miles * 2.6);
    const etaMinutes = courierArrives + travel;
    return {
      providerQuoteId: `dqt_mock_${randomUUID().replace(/-/g, "").slice(0, 22)}`,
      feeCents: cents,
      currency: "usd",
      etaMinutes,
      dropoffEta: new Date(start.getTime() + etaMinutes * 60_000),
      expiresAt: new Date(Date.now() + 15 * 60_000),
      distanceMiles: Math.round(miles * 100) / 100,
    };
  }

  async createDelivery(input: DeliveryInput): Promise<Delivery> {
    if (!input.quoteId.startsWith("dqt_mock_")) throw new UberError("Unknown quote", "invalid_params", 400);
    const id = `del_mock_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 22)}`;
    const { cents } = mockFee(input);
    return {
      id,
      status: "pending",
      trackingUrl: `${this.appUrl}/track/${encodeURIComponent(input.externalId)}`,
      feeCents: cents,
      courier: null,
    };
  }

  async cancelDelivery() {}
}
