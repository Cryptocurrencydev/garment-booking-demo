import { BRAND } from "./config";
import { q } from "./db";

/**
 * Notification adapters. Email goes through Resend when RESEND_API_KEY is set (test mode uses
 * onboarding@resend.dev), SMS through Twilio when TWILIO_* are set. Without keys every message
 * is written to the outbox table (shown in /admin) so the flow is fully visible in the demo.
 */
type Ref = { bookingId?: string | null; membershipId?: string | null };

export function ownerEmail() {
  return process.env.OWNER_EMAIL || "owner@marlowefinch.example";
}

export function ownerPhone() {
  return process.env.OWNER_PHONE || null;
}

export async function sendEmail(msg: { to: string; subject: string; text: string; html: string; audience: "customer" | "owner" } & Ref) {
  const key = process.env.RESEND_API_KEY;
  let provider = "outbox";
  let providerId: string | null = null;
  let status = "logged";
  let error: string | null = null;
  if (key) {
    provider = "resend";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || `${BRAND.name} <onboarding@resend.dev>`,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.ok) {
        providerId = j.id ?? null;
        status = "sent";
      } else {
        status = "failed";
        error = j.message ?? `HTTP ${res.status}`;
      }
    } catch (e) {
      status = "failed";
      error = String(e);
    }
  }
  await q(
    `insert into notifications (channel, audience, to_addr, subject, body_text, body_html, provider, provider_id, status, error, booking_id, membership_id)
     values ('email', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [msg.audience, msg.to, msg.subject, msg.text, msg.html, provider, providerId, status, error, msg.bookingId ?? null, msg.membershipId ?? null],
  );
}

export async function sendSms(msg: { to: string | null | undefined; body: string; audience: "customer" | "owner" } & Ref) {
  if (!msg.to) return;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  let provider = "outbox";
  let providerId: string | null = null;
  let status = "logged";
  let error: string | null = null;
  if (sid && tok && from) {
    provider = "twilio";
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: msg.to, From: from, Body: msg.body }),
      });
      const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (res.ok) {
        providerId = j.sid ?? null;
        status = "sent";
      } else {
        status = "failed";
        error = j.message ?? `HTTP ${res.status}`;
      }
    } catch (e) {
      status = "failed";
      error = String(e);
    }
  }
  await q(
    `insert into notifications (channel, audience, to_addr, body_text, provider, provider_id, status, error, booking_id, membership_id)
     values ('sms', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [msg.audience, msg.to, msg.body, provider, providerId, status, error, msg.bookingId ?? null, msg.membershipId ?? null],
  );
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Minimal branded email shell. */
export function emailHtml(title: string, rows: [string, string][], intro: string, cta?: { label: string; href: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f1e8;font-family:Helvetica,Arial,sans-serif;color:#1c2420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fffdf8;border:1px solid #e4dccb;border-radius:14px" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 28px 8px;font-family:Georgia,serif;font-size:22px;color:#1f3b2d">${esc(BRAND.name)}</td></tr>
<tr><td style="padding:0 28px 8px;font-size:18px;font-weight:bold">${esc(title)}</td></tr>
<tr><td style="padding:0 28px 16px;font-size:15px;line-height:1.5;color:#4a524d">${esc(intro)}</td></tr>
<tr><td style="padding:0 28px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#7a807b;width:40%;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;vertical-align:top">${esc(v)}</td></tr>`).join("")}
</table></td></tr>
${cta ? `<tr><td style="padding:0 28px 28px"><a href="${esc(cta.href)}" style="display:inline-block;background:#1f3b2d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:14px">${esc(cta.label)}</a></td></tr>` : ""}
</table><p style="font-size:12px;color:#9a9f9b">Demo by DC Tech · sandbox transaction, no real charge</p></td></tr></table></body></html>`;
}

export function emailText(title: string, rows: [string, string][], intro: string, cta?: { label: string; href: string }) {
  return [`${BRAND.name} — ${title}`, "", intro, "", ...rows.map(([k, v]) => `${k}: ${v}`), cta ? `\n${cta.label}: ${cta.href}` : ""].join("\n");
}
