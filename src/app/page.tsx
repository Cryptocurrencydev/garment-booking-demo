import Link from "next/link";
import { SandboxBanner, SiteFooter } from "@/components/chrome";
import { BRAND, MEMBERSHIP, SERVICES, STORE, money } from "@/lib/config";
import { STORE_HOURS_TEXT } from "@/lib/time";

const ACTIONS = [
  {
    href: "/book/pickup",
    title: "Schedule a pickup",
    sub: "An Uber courier collects from your door and brings it to us.",
    icon: (
      <path d="M3 12h11m0 0l-4-4m4 4l-4 4M14 5h5a2 2 0 012 2v10a2 2 0 01-2 2h-5" />
    ),
  },
  {
    href: "/book/delivery",
    title: "Schedule a delivery",
    sub: "Your cleaned, pressed garments, brought home in a window you choose.",
    icon: <path d="M21 12H10m0 0l4-4m-4 4l4 4M10 5H5a2 2 0 00-2 2v10a2 2 0 002 2h5" />,
  },
  {
    href: "/membership",
    title: "Become a member",
    sub: `${money(MEMBERSHIP.priceCents)}/month · free pickup & delivery, ${MEMBERSHIP.discountPct}% off.`,
    icon: <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" />,
  },
];

export default function Home() {
  return (
    <>
      <SandboxBanner />
      <main className="mx-auto max-w-5xl px-4">
        <section className="pt-10 pb-8 sm:pt-16">
          <p className="text-xs font-medium tracking-[0.2em] text-brass uppercase">Garment care · Montclair, NJ</p>
          <h1 className="mt-3 font-display text-[2.6rem] leading-[1.05] tracking-tight text-forest sm:text-6xl">{BRAND.name}</h1>
          <p className="mt-3 max-w-md text-lg text-muted">{BRAND.tagline} Dry cleaning, pressing and alterations, with an Uber courier at your door.</p>
        </section>

        <section aria-label="Book" className="grid gap-3 sm:grid-cols-3">
          {ACTIONS.map((a, i) => (
            <Link
              key={a.href}
              href={a.href}
              data-testid={`action-${a.href.split("/").pop()}`}
              className={`group flex min-h-28 items-center gap-4 rounded-2xl border p-5 transition-colors sm:flex-col sm:items-start sm:p-6 ${
                i === 0 ? "border-forest bg-forest text-paper hover:bg-forest-2" : "border-line bg-paper hover:border-brass"
              }`}
            >
              <span className={`grid size-12 shrink-0 place-items-center rounded-full ${i === 0 ? "bg-paper/10" : "bg-brass-soft text-forest"}`}>
                <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {a.icon}
                </svg>
              </span>
              <span className="flex-1">
                <span className="block font-display text-xl">{a.title}</span>
                <span className={`mt-1 block text-sm ${i === 0 ? "text-paper/75" : "text-muted"}`}>{a.sub}</span>
              </span>
              <svg aria-hidden className="shrink-0 transition-transform group-hover:translate-x-0.5 sm:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
            </Link>
          ))}
        </section>

        <section className="mt-14 grid gap-10 sm:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl text-forest">How it works</h2>
            <ol className="mt-4 space-y-4">
              {[
                ["Enter your address", "See the exact Uber courier fee and timing before you pay."],
                ["Choose a two-hour window", "Weekdays 7 am – 7 pm, Saturdays until 5 pm."],
                ["Pay securely with Square", "Save your card for one-tap checkout next time."],
                ["Track your courier", "We text you when a courier is assigned and on arrival."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-brass font-display text-brass">{i + 1}</span>
                  <span>
                    <span className="block font-medium">{t}</span>
                    <span className="text-sm text-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="font-display text-2xl text-forest">Garment care prices</h2>
            <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-paper px-4">
              {SERVICES.map((s) => (
                <li key={s.id} className="flex justify-between py-3 text-sm">
                  <span>{s.name}</span>
                  <span className="tabular text-muted">{money(s.unitCents)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-faint">Members save {MEMBERSHIP.discountPct}% and never pay a courier fee.</p>
          </div>
        </section>

        <section className="mt-14 rounded-2xl border border-line bg-paper p-6 sm:flex sm:items-start sm:justify-between">
          <div>
            <h2 className="font-display text-2xl text-forest">The atelier</h2>
            <address className="mt-2 text-sm text-muted not-italic">
              {STORE.address.line1}
              <br />
              {STORE.address.city}, {STORE.address.state} {STORE.address.zip}
              <br />
              {BRAND.phone}
            </address>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm sm:mt-0">
            {STORE_HOURS_TEXT.map(([d, h]) => (
              <div key={d} className="contents">
                <dt className="text-muted">{d}</dt>
                <dd>{h}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
