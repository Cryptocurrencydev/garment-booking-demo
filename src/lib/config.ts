// Store + business configuration. Everything a real owner would change lives here.
export const BRAND = {
  name: "Marlowe & Finch",
  short: "M&F",
  tagline: "Garment care, collected and returned.",
  phone: "(973) 555-0142",
  email: "hello@marlowefinch.example",
};

export const STORE = {
  name: "Marlowe & Finch Garment Care",
  // Fictional storefront in Montclair, NJ (coordinates used for Uber pickup/dropoff).
  address: {
    line1: "41 Church Street",
    city: "Montclair",
    state: "NJ",
    zip: "07042",
    country: "US",
    lat: 40.81572,
    lon: -74.21315,
  },
  timezone: "America/New_York",
  // 0 = Sunday. Hours in 24h store-local time; null = closed.
  hours: {
    0: null,
    1: [7, 19],
    2: [7, 19],
    3: [7, 19],
    4: [7, 19],
    5: [7, 19],
    6: [8, 17],
  } as Record<number, [number, number] | null>,
  windowHours: 2, // length of each courier window
  leadMinutes: 60, // earliest window starts at least this far ahead
  daysAhead: 5,
  maxRadiusMiles: 12, // Uber Direct coverage for a local cleaner
  handoffNotes: "Ring the bell at the counter; garment bags are tagged with the booking reference.",
};

export type ServiceItem = { id: string; name: string; unitCents: number; note?: string };

export const SERVICES: ServiceItem[] = [
  { id: "shirt", name: "Shirt, laundered & pressed", unitCents: 450 },
  { id: "trousers", name: "Trousers", unitCents: 950 },
  { id: "suit", name: "Suit, two-piece", unitCents: 2200 },
  { id: "dress", name: "Dress", unitCents: 1800 },
  { id: "knit", name: "Knitwear", unitCents: 1000 },
  { id: "coat", name: "Coat or outerwear", unitCents: 2800 },
  { id: "duvet", name: "Duvet or comforter", unitCents: 3500 },
];

export const MEMBERSHIP = {
  name: "The Marlowe Membership",
  priceCents: 5900,
  cadence: "MONTHLY" as const,
  discountPct: 15,
  perks: [
    "Free Uber pickup and delivery on every order",
    "15% off all garment care",
    "Priority 24-hour turnaround",
    "Card on file, cancel any time",
  ],
};

export const CURRENCY = "USD";

export function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY }).format(cents / 100);
}
