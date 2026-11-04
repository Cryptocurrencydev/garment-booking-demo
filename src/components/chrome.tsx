import Link from "next/link";
import { BRAND } from "@/lib/config";
import { uberLive } from "@/lib/uber";

export function SiteHeader({ back }: { back?: { href: string; label: string } }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        {back ? (
          <Link href={back.href} className="-ml-2 flex min-h-11 items-center gap-1 rounded-full px-2 text-sm text-muted hover:text-ink">
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
            {back.label}
          </Link>
        ) : (
          <span className="w-10" />
        )}
        <Link href="/" className="font-display text-lg tracking-tight text-forest" aria-label={`${BRAND.name} home`}>
          {BRAND.name}
        </Link>
        <Link href="/membership" className="flex min-h-11 items-center rounded-full px-2 text-sm text-muted hover:text-ink">
          Member
        </Link>
      </div>
    </header>
  );
}

export function SandboxBanner() {
  const live = uberLive();
  return (
    <div className="border-b border-line bg-brass-soft/60 text-[12px] leading-tight text-warn">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center">
        <span>Demo · Square sandbox (test cards only)</span>
        <span aria-hidden>·</span>
        <span data-testid="uber-mode">{live ? "Uber Direct sandbox" : "Uber Direct sandbox pending — simulated courier"}</span>
      </div>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-8 text-sm text-faint sm:flex-row sm:items-center sm:justify-between">
        <p>
          {BRAND.name} is a fictional brand. Sandbox payments only.
        </p>
        <p>
          Demo by{" "}
          <a href="https://dctechltd.com" target="_blank" rel="noopener" className="font-medium text-forest underline underline-offset-2">
            DC Tech
          </a>
        </p>
      </div>
    </footer>
  );
}
