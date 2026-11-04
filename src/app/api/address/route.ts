import { NextResponse, type NextRequest } from "next/server";
import { STORE } from "@/lib/config";

/**
 * Free address autocomplete (Photon / OpenStreetMap), biased to the store. Swap for Google Places
 * by setting GOOGLE_MAPS_API_KEY in a later iteration; the response shape stays the same.
 */
const STATES: Record<string, string> = { "New Jersey": "NJ", "New York": "NY", Pennsylvania: "PA", Connecticut: "CT", Delaware: "DE" };

type Feature = {
  properties: { housenumber?: string; street?: string; name?: string; city?: string; town?: string; village?: string; district?: string; state?: string; postcode?: string; countrycode?: string; osm_key?: string };
  geometry: { coordinates: [number, number] };
};

export async function GET(req: NextRequest) {
  const qStr = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (qStr.length < 3) return NextResponse.json({ results: [] });
  const typedNumber = qStr.match(/^\s*(\d+[A-Za-z]?)\b/)?.[1];
  const { lat, lon } = STORE.address;
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", qStr);
  url.searchParams.set("limit", "10");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("lang", "en");
  url.searchParams.set("bbox", "-75.6,39.6,-73.4,41.4"); // northern NJ + NYC metro
  try {
    const res = await fetch(url, { headers: { "User-Agent": "garment-booking-demo/1.0" }, signal: AbortSignal.timeout(6000), next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { features: Feature[] };
    const seen = new Set<string>();
    const results = j.features
      .filter((f) => f.properties.countrycode === "US" && (f.properties.street || f.properties.osm_key === "highway"))
      .map((f) => {
        const p = f.properties;
        const street = p.street ?? p.name ?? "";
        const number = p.housenumber ?? typedNumber;
        const city = p.city ?? p.town ?? p.village ?? p.district ?? "";
        const state = STATES[p.state ?? ""] ?? p.state ?? "";
        const line1 = [number, street].filter(Boolean).join(" ");
        return { line1, city, state, zip: p.postcode ?? "", lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], exact: Boolean(p.housenumber) };
      })
      .filter((r) => r.line1 && r.city && /^\d{5}/.test(r.zip) && /^\d/.test(r.line1))
      .filter((r) => {
        const k = `${r.line1}|${r.zip}`.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 5)
      .map((r) => ({ ...r, zip: r.zip.slice(0, 5), label: `${r.line1}, ${r.city}, ${r.state} ${r.zip.slice(0, 5)}` }));
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [], error: "Address lookup is unavailable right now." }, { status: 200 });
  }
}
