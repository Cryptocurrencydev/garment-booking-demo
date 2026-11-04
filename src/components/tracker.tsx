"use client";

import { useEffect, useState } from "react";

type Track = {
  status: string;
  uberStatus: string | null;
  label: string;
  courier: { name: string; vehicle?: string; rating?: number } | null;
  events: { status: string; detail: string; at: string }[];
};

const STEPS = ["pending", "pickup", "pickup_complete", "dropoff", "delivered"];

export function Tracker({ refCode, kind, initial }: { refCode: string; kind: "pickup" | "delivery"; initial: Track }) {
  const [t, setT] = useState<Track>(initial);
  useEffect(() => {
    if (["delivered", "canceled", "returned"].includes(t.uberStatus ?? "")) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/track/${encodeURIComponent(refCode)}`, { cache: "no-store" });
        if (r.ok) setT(await r.json());
      } catch {
        /* offline; keep last state */
      }
    }, 5000);
    return () => clearInterval(id);
  }, [refCode, t.uberStatus]);

  const idx = STEPS.indexOf(t.uberStatus ?? "pending");
  const names =
    kind === "pickup"
      ? ["Requested", "Courier assigned", "Collected", "En route", "At the atelier"]
      : ["Requested", "Courier assigned", "Collected from atelier", "En route", "Delivered"];
  const fmt = (s: string) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (t.status === "dispatch_failed") {
    return <p className="rounded-xl bg-brass-soft p-3 text-sm text-warn">We&apos;re arranging your courier by hand and will text you shortly.</p>;
  }
  return (
    <div aria-live="polite">
      <p className="font-medium" data-testid="track-label">{t.label}</p>
      {t.courier && (
        <p className="mt-1 text-sm text-muted">
          {t.courier.name}
          {t.courier.rating ? ` · ★ ${t.courier.rating.toFixed(1)}` : ""}
          {t.courier.vehicle ? ` · ${t.courier.vehicle}` : ""}
        </p>
      )}
      <ol className="mt-4 space-y-3">
        {names.map((n, i) => {
          const ev = t.events.find((e) => e.status === STEPS[i]);
          const done = i <= idx && t.uberStatus !== "canceled";
          return (
            <li key={n} className="flex items-center gap-3 text-sm">
              <span className={`grid size-6 shrink-0 place-items-center rounded-full border ${done ? "border-forest bg-forest text-paper" : "border-line bg-paper text-faint"}`}>
                {done ? (
                  <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>
                ) : (
                  <span className="size-1.5 rounded-full bg-line" />
                )}
              </span>
              <span className={done ? "text-ink" : "text-faint"}>{n}</span>
              {ev && <span className="ml-auto text-xs text-faint tabular">{fmt(ev.at)}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
