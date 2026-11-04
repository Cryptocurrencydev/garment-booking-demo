/**
 * US (NANP) phone validation matching what Square accepts: 10 digits (optionally prefixed by 1),
 * area code and exchange must each start with 2–9. e.g. 432-098-2220 is rejected (exchange 098).
 */
export function normalizeUsPhone(input?: string | null): string | null {
  if (!input) return null;
  let d = input.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  return `+1${d}`;
}

export function isValidUsPhone(input?: string | null) {
  return normalizeUsPhone(input) !== null;
}

export const PHONE_HINT = "Enter a valid US mobile number, e.g. (973) 555-0142.";
