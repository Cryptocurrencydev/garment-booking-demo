import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/chrome";
import { advanceMockDeliveries } from "@/lib/bookings";
import { BRAND, money } from "@/lib/config";
import { q } from "@/lib/db";
import { isAdmin } from "@/lib/session";
import { formatStamp, formatWhen } from "@/lib/time";
import { uberLive } from "@/lib/uber";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Owner dashboard" };

const TABS = [
  ["requests", "Requests"],
  ["members", "Members"],
  ["payments", "Payments"],
  ["outbox", "Notifications"],
] as const;

const STATUS_TONE: Record<string, string> = {
  delivered: "bg-ok/10 text-ok",
  dispatch_failed: "bg-bad/10 text-bad",
  payment_failed: "bg-bad/10 text-bad",
  canceled: "bg-bad/10 text-bad",
  past_due: "bg-bad/10 text-bad",
  FAILED: "bg-bad/10 text-bad",
  active: "bg-ok/10 text-ok",
  COMPLETED: "bg-ok/10 text-ok",
  PAID: "bg-ok/10 text-ok",
};

function Pill({ s }: { s: string | null }) {
  if (!s) return <span className="text-faint">—</span>;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${STATUS_TONE[s] ?? "bg-brass-soft text-warn"}`}>{s.replace(/_/g, " ")}</span>;
}

export default async function Admin({ searchParams }: PageProps<"/admin">) {
  const sp = await searchParams;
  if (!(await isAdmin())) {
    return (
      <main className="mx-auto max-w-sm px-4 pt-20">
        <h1 className="font-display text-3xl text-forest">{BRAND.name}</h1>
        <p className="mt-1 text-muted">Owner dashboard</p>
        <form method="post" action="/api/admin/login" className="mt-6 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Password</span>
            <input name="password" type="password" required className="input" autoComplete="current-password" />
          </label>
          {sp.error && <p role="alert" className="text-sm text-bad">Incorrect password.</p>}
          <button className="btn-primary w-full">Sign in</button>
        </form>
        <p className="mt-4 text-xs text-faint">Demo password is shared with the pitch.</p>
      </main>
    );
  }

  await advanceMockDeliveries();
  const tab = (typeof sp.tab === "string" && TABS.some(([k]) => k === sp.tab) ? sp.tab : "requests") as (typeof TABS)[number][0];

  const [stats] = await q<{ today: number; open: number; members: number; revenue: number; failed: number }>(`
    select
      (select count(*) from bookings where created_at > now() - interval '24 hours' and status <> 'payment_failed')::int as today,
      (select count(*) from bookings where status in ('dispatched','courier_assigned','picked_up','en_route'))::int as open,
      (select count(*) from memberships where status in ('active','pending','past_due'))::int as members,
      (select coalesce(sum(amount_cents),0) from payments where status in ('COMPLETED','PAID'))::int as revenue,
      (select count(*) from bookings where status = 'dispatch_failed')::int as failed`);

  return (
    <>
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="font-display text-lg text-forest">{BRAND.name}</Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-faint sm:inline">{uberLive() ? "Uber Direct sandbox" : "Uber Direct sandbox pending (mock)"} · Square sandbox</span>
            <form method="post" action="/api/admin/logout"><button className="min-h-11 text-muted underline">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-6">
        <h1 className="font-display text-3xl text-forest">Today at the atelier</h1>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["Requests (24h)", String(stats.today)],
            ["Couriers out", String(stats.open)],
            ["Members", String(stats.members)],
            ["Collected", money(stats.revenue)],
            ["Needs attention", String(stats.failed)],
          ].map(([k, v]) => (
            <div key={k} className="card p-4">
              <p className="text-xs text-faint">{k}</p>
              <p className="mt-1 font-display text-2xl text-forest tabular">{v}</p>
            </div>
          ))}
        </div>

        <nav className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4" aria-label="Sections">
          {TABS.map(([k, label]) => (
            <Link key={k} href={`/admin?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm ${tab === k ? "border-forest bg-forest text-paper" : "border-line bg-paper"}`}>
              {label}
            </Link>
          ))}
        </nav>

        <section className="mt-4">{tab === "requests" ? <Requests /> : tab === "members" ? <Members /> : tab === "payments" ? <Payments /> : <Outbox />}</section>
      </main>
      <SiteFooter />
    </>
  );
}

async function Requests() {
  const rows = await q<{
    ref: string; kind: string; status: string; name: string; phone: string; email: string; address: { line1: string; city: string }; window_start: Date; window_end: Date;
    total_cents: number; delivery_fee_cents: number; delivery_fee_waived: boolean; uber_delivery_id: string | null; uber_status: string | null; uber_tracking_url: string | null; courier: { name: string } | null;
    dispatch_error: string | null; payment_status: string | null; items: { qty: number; name: string }[]; notes: string | null; ticket_number: string | null; created_at: Date;
  }>(`select b.*, c.name, c.phone, c.email from bookings b join customers c on c.id=b.customer_id order by b.created_at desc limit 100`);
  if (!rows.length) return <Empty text="No pickups or deliveries yet." />;
  return (
    <ul className="space-y-3" data-testid="admin-requests">
      {rows.map((r) => (
        <li key={r.ref} className="card p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.kind === "pickup" ? "bg-forest text-paper" : "bg-brass text-paper"}`}>{r.kind}</span>
            <span className="font-medium tabular">{r.ref}</span>
            <Pill s={r.status} />
            <span className="ml-auto text-xs text-faint">{formatStamp(r.created_at)}</span>
          </div>
          <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-3">
            <p><span className="text-faint">Customer </span>{r.name} · {r.phone}</p>
            <p><span className="text-faint">Address </span>{r.address.line1}, {r.address.city}</p>
            <p><span className="text-faint">Window </span>{formatWhen(r.window_start, r.window_end)}</p>
            <p className="sm:col-span-2"><span className="text-faint">Garments </span>{r.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}{r.ticket_number ? ` · ticket ${r.ticket_number}` : ""}</p>
            <p><span className="text-faint">Paid </span>{money(r.total_cents)} <Pill s={r.payment_status} /></p>
            <p className="sm:col-span-2"><span className="text-faint">Uber </span>{r.uber_delivery_id ? <><Pill s={r.uber_status} /> {r.courier?.name ? `${r.courier.name} · ` : ""}<span className="font-mono text-xs">{r.uber_delivery_id}</span>{r.uber_tracking_url && <> · <a className="underline" href={r.uber_tracking_url} target="_blank" rel="noopener">track</a></>}</> : <span className="text-bad">{r.dispatch_error ?? "not dispatched"}</span>}</p>
            <p><span className="text-faint">Courier fee </span>{money(r.delivery_fee_cents)}{r.delivery_fee_waived ? " (covered, member)" : ""}</p>
            {r.notes && <p className="sm:col-span-3"><span className="text-faint">Notes </span>{r.notes}</p>}
          </div>
          {r.status === "dispatch_failed" && (
            <form method="post" action="/api/admin/dispatch" className="mt-3">
              <input type="hidden" name="ref" value={r.ref} />
              <button className="btn-primary min-h-10 px-4 text-sm">Retry Uber dispatch</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

async function Members() {
  const rows = await q<{ name: string; email: string; phone: string; status: string; square_subscription_id: string; started_at: Date; charged_through: string | null; cancel_effective: string | null; card_brand: string | null; card_last4: string | null }>(
    `select c.name, c.email, c.phone, c.card_brand, c.card_last4, m.status, m.square_subscription_id, m.started_at, m.charged_through::text, m.cancel_effective::text
     from memberships m join customers c on c.id = m.customer_id order by m.created_at desc limit 200`,
  );
  if (!rows.length) return <Empty text="No members yet." />;
  return (
    <ul className="space-y-3" data-testid="admin-members">
      {rows.map((r) => (
        <li key={r.square_subscription_id} className="card grid gap-1 p-4 text-sm sm:grid-cols-4">
          <p className="font-medium">{r.name}<span className="block text-xs font-normal text-faint">{r.email} · {r.phone}</span></p>
          <p><Pill s={r.cancel_effective ? `ends ${r.cancel_effective}` : r.status} /></p>
          <p><span className="text-faint">Next bill </span>{r.cancel_effective ? "—" : r.charged_through ?? "—"}</p>
          <p className="truncate"><span className="text-faint">Square </span><span className="font-mono text-xs">{r.square_subscription_id}</span>{r.card_last4 ? ` · •••• ${r.card_last4}` : ""}</p>
        </li>
      ))}
    </ul>
  );
}

async function Payments() {
  const rows = await q<{ kind: string; amount_cents: number; status: string; square_payment_id: string | null; square_invoice_id: string | null; receipt_url: string | null; created_at: Date; name: string | null; ref: string | null }>(
    `select p.*, c.name, b.ref from payments p left join customers c on c.id=p.customer_id left join bookings b on b.id=p.booking_id order by p.created_at desc limit 200`,
  );
  if (!rows.length) return <Empty text="No payments yet." />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm" data-testid="admin-payments">
        <thead className="text-xs text-faint"><tr className="border-b border-line">{["When", "Customer", "For", "Amount", "Status", "Square id"].map((h) => <th key={h} className="px-4 py-3 font-normal">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              <td className="px-4 py-3 whitespace-nowrap">{formatStamp(r.created_at)}</td>
              <td className="px-4 py-3">{r.name}</td>
              <td className="px-4 py-3">{r.kind === "booking" ? r.ref : "Membership"}</td>
              <td className="px-4 py-3 tabular">{money(r.amount_cents)}</td>
              <td className="px-4 py-3"><Pill s={r.status} /></td>
              <td className="px-4 py-3 font-mono text-xs">{r.receipt_url ? <a className="underline" href={r.receipt_url} target="_blank" rel="noopener">{r.square_payment_id}</a> : r.square_payment_id ?? r.square_invoice_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Outbox() {
  const rows = await q<{ id: number; channel: string; audience: string; to_addr: string; subject: string | null; body_text: string; provider: string; status: string; created_at: Date }>(
    "select id, channel, audience, to_addr, subject, body_text, provider, status, created_at from notifications order by id desc limit 100",
  );
  if (!rows.length) return <Empty text="No notifications yet." />;
  return (
    <>
      <p className="mb-3 text-xs text-faint">Email via Resend and SMS via Twilio when keys are configured; otherwise messages land here (outbox).</p>
      <ul className="space-y-2" data-testid="admin-outbox">
        {rows.map((r) => (
          <li key={r.id} className="card p-4 text-sm">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="rounded-full bg-brass-soft px-2 py-0.5 text-xs uppercase">{r.channel}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${r.audience === "owner" ? "bg-forest text-paper" : "bg-line"}`}>{r.audience}</span>
                <span className="font-medium">{r.subject ?? r.body_text.slice(0, 60)}</span>
                <span className="ml-auto text-xs text-faint">{r.to_addr} · {r.provider} {r.status} · {formatStamp(r.created_at)}</span>
              </summary>
              <pre className="mt-3 text-xs whitespace-pre-wrap text-muted">{r.body_text}</pre>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="card p-6 text-center text-sm text-faint">{text}</p>;
}
