import { STORE } from "./config";

const TZ = STORE.timezone;

function tzOffsetMs(utcMs: number, tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Store-local wall time → UTC Date (DST-safe). */
export function zonedToUtc(y: number, m: number, d: number, h: number, min = 0) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - tzOffsetMs(guess);
  return new Date(guess - tzOffsetMs(first));
}

/** Store-local Y/M/D and weekday for an instant. */
export function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday: wd };
}

export type TimeWindow = { start: string; end: string; dayLabel: string; label: string };

/** Courier windows inside store hours for the next few open days. */
export function availableWindows(now = new Date()): TimeWindow[] {
  const out: TimeWindow[] = [];
  const earliest = now.getTime() + STORE.leadMinutes * 60_000;
  for (let i = 0; i < STORE.daysAhead + 3 && new Set(out.map((w) => w.dayLabel)).size < STORE.daysAhead; i++) {
    const day = zonedParts(new Date(now.getTime() + i * 86_400_000));
    const hours = STORE.hours[day.weekday];
    if (!hours) continue;
    for (let h = hours[0]; h + STORE.windowHours <= hours[1]; h += STORE.windowHours) {
      const start = zonedToUtc(day.y, day.m, day.d, h);
      if (start.getTime() < earliest) continue;
      const end = new Date(start.getTime() + STORE.windowHours * 3_600_000);
      out.push({ start: start.toISOString(), end: end.toISOString(), dayLabel: dayLabel(start, now), label: rangeLabel(start, end) });
    }
  }
  return out;
}

export function isValidWindow(startIso: string, now = new Date()) {
  return availableWindows(now).find((w) => w.start === new Date(startIso).toISOString()) ?? null;
}

export function dayLabel(date: Date, now = new Date()) {
  const a = zonedParts(date);
  const b = zonedParts(now);
  const tomorrow = zonedParts(new Date(now.getTime() + 86_400_000));
  if (a.y === b.y && a.m === b.m && a.d === b.d) return "Today";
  if (a.y === tomorrow.y && a.m === tomorrow.m && a.d === tomorrow.d) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(date);
}

export function timeLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(date).replace(":00", "");
}

export function rangeLabel(start: Date, end: Date) {
  return `${timeLabel(start)} – ${timeLabel(end)}`;
}

export function formatWhen(start: Date | string, end: Date | string) {
  const s = new Date(start);
  const e = new Date(end);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(s);
  return `${day}, ${rangeLabel(s, e)}`;
}

export function formatStamp(d: Date | string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

export const STORE_HOURS_TEXT = [
  ["Mon – Fri", "7 am – 7 pm"],
  ["Saturday", "8 am – 5 pm"],
  ["Sunday", "Closed"],
];
