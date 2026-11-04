"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

type SquareCardInstance = {
  attach: (sel: string | HTMLElement) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; details?: { billing?: { postalCode?: string } }; errors?: { message: string }[] }>;
  destroy: () => Promise<boolean>;
};
type SquareGlobal = { payments: (appId: string, locationId: string) => Promise<{ card: (opts?: unknown) => Promise<SquareCardInstance> }> | { card: (opts?: unknown) => Promise<SquareCardInstance> } };

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

export type SquareCardHandle = { tokenize: () => Promise<{ token: string; postalCode?: string }> };

let scriptPromise: Promise<void> | null = null;
function loadSdk(env: string) {
  if (typeof window !== "undefined" && window.Square) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = env === "production" ? "https://web.squarecdn.com/v1/square.js" : "https://sandbox.web.squarecdn.com/v1/square.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load Square"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Square Web Payments SDK card field (PCI-scoped iframe; we only ever see a single-use token). */
export const SquareCard = forwardRef<SquareCardHandle, { appId: string; locationId: string; env: string }>(function SquareCard({ appId, locationId, env }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const card = useRef<SquareCardInstance | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let instance: SquareCardInstance | null = null;
    (async () => {
      try {
        await loadSdk(env);
        const payments = await window.Square!.payments(appId, locationId);
        instance = await payments.card({
          style: {
            input: { fontSize: "16px", color: "#1c2420" },
            "input::placeholder": { color: "#8a908b" },
            ".input-container": { borderColor: "#e4dccb", borderRadius: "12px" },
            ".input-container.is-focus": { borderColor: "#a8834a" },
          },
        });
        if (cancelled) {
          await instance.destroy();
          return;
        }
        await instance.attach(box.current!);
        card.current = instance;
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      card.current = null;
      instance?.destroy().catch(() => undefined);
    };
  }, [appId, locationId, env]);

  useImperativeHandle(ref, () => ({
    async tokenize() {
      if (!card.current) throw new Error("The card form is still loading.");
      const r = await card.current.tokenize();
      if (r.status !== "OK" || !r.token) throw new Error(r.errors?.[0]?.message ?? "Please check your card details.");
      return { token: r.token, postalCode: r.details?.billing?.postalCode };
    },
  }));

  return (
    <div>
      <div ref={box} data-testid="square-card" className="min-h-[90px]" />
      {state === "loading" && <p className="-mt-16 mb-10 text-center text-sm text-faint">Loading secure card form…</p>}
      {state === "error" && <p className="text-sm text-bad">The secure card form couldn&apos;t load. Check your connection and refresh.</p>}
      <p className="mt-1 flex items-center gap-1.5 text-xs text-faint">
        <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
        Payments by Square. Sandbox test card: 4111 1111 1111 1111, any future date, any CVV, ZIP 07042.
      </p>
    </div>
  );
});
