export type Address = {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
  country?: string;
  lat: number;
  lon: number;
};

export type Stop = {
  name: string;
  phone: string;
  address: Address;
  notes?: string;
};

export type QuoteInput = {
  pickup: Address;
  dropoff: Address;
  pickupReadyAt?: Date; // start of the customer's window (scheduled)
  pickupDeadlineAt?: Date;
  dropoffReadyAt?: Date;
  dropoffDeadlineAt?: Date;
  manifestValueCents?: number;
};

export type Quote = {
  providerQuoteId: string;
  feeCents: number;
  currency: string;
  etaMinutes: number; // minutes from window start (or now) to dropoff
  dropoffEta: Date;
  expiresAt: Date;
  distanceMiles?: number;
};

export type DeliveryInput = QuoteInput & {
  quoteId: string;
  pickupStop: Stop;
  dropoffStop: Stop;
  externalId: string; // our booking ref
  manifest: { name: string; quantity: number }[];
  idempotencyKey: string;
};

/** Uber Direct delivery statuses. */
export type UberStatus = "pending" | "pickup" | "pickup_complete" | "dropoff" | "delivered" | "canceled" | "returned";

export type Courier = { name: string; vehicle_type?: string; phone_number?: string; img_href?: string; rating?: number };

export type Delivery = {
  id: string;
  status: UberStatus;
  trackingUrl: string;
  feeCents: number;
  courier?: Courier | null;
};

export class UberError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface UberDirect {
  readonly mode: "uber-direct" | "uber-mock";
  createQuote(input: QuoteInput): Promise<Quote>;
  createDelivery(input: DeliveryInput): Promise<Delivery>;
  cancelDelivery(id: string): Promise<void>;
}
