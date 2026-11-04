import "server-only";
import { isActiveMember } from "./bookings";
import { one } from "./db";
import { getCustomerSession } from "./session";

export async function loadMe() {
  const id = await getCustomerSession();
  if (!id) return null;
  const c = await one<{ id: string; name: string; email: string; phone: string; card_brand: string | null; card_last4: string | null; square_card_id: string | null }>(
    "select id, name, email, phone, card_brand, card_last4, square_card_id from customers where id=$1",
    [id],
  );
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    card: c.square_card_id ? { brand: c.card_brand, last4: c.card_last4 } : null,
    member: await isActiveMember(c.id),
  };
}

export function squarePublic() {
  return {
    appId: process.env.SQUARE_APPLICATION_ID ?? "",
    locationId: process.env.SQUARE_LOCATION_ID ?? "",
    env: process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox",
  };
}
