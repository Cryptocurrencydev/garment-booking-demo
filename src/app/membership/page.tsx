import type { Metadata } from "next";
import { SandboxBanner, SiteFooter, SiteHeader } from "@/components/chrome";
import { MembershipClient } from "@/components/membership-client";
import { MEMBERSHIP, money } from "@/lib/config";
import { loadMe, squarePublic } from "@/lib/me";
import { currentMembership } from "@/lib/memberships";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Membership" };

export default async function MembershipPage() {
  const me = await loadMe();
  const m = me ? await currentMembership(me.id) : null;
  return (
    <>
      <SandboxBanner />
      <SiteHeader back={{ href: "/", label: "Home" }} />
      <main className="mx-auto max-w-lg px-4 pt-8">
        <p className="text-xs font-medium tracking-[0.2em] text-brass uppercase">Monthly membership</p>
        <h1 className="mt-1 font-display text-4xl text-forest">{MEMBERSHIP.name}</h1>
        <div className="card mt-6 overflow-hidden">
          <div className="bg-forest p-6 text-paper">
            <p className="font-display text-5xl tabular">
              {money(MEMBERSHIP.priceCents)}
              <span className="font-sans text-base text-paper/70"> / month</span>
            </p>
            <p className="mt-1 text-sm text-paper/75">Billed monthly through Square. Cancel any time.</p>
          </div>
          <ul className="space-y-3 p-6">
            {MEMBERSHIP.perks.map((p) => (
              <li key={p} className="flex gap-3 text-sm">
                <svg aria-hidden className="mt-0.5 shrink-0 text-brass" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 12l5 5L20 7" /></svg>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <MembershipClient
          square={squarePublic()}
          me={me && { name: me.name, email: me.email, phone: me.phone, card: me.card }}
          membership={m && { status: m.status, chargedThrough: m.charged_through ? String(m.charged_through).slice(0, 10) : null, cancelEffective: m.cancel_effective ? new Date(m.cancel_effective).toISOString().slice(0, 10) : null, startedAt: m.started_at.toISOString() }}
        />
      </main>
      <SiteFooter />
    </>
  );
}
