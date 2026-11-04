-- Marlowe & Finch garment care booking demo. Idempotent: safe to run repeatedly.
create extension if not exists pgcrypto;

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  phone text,
  square_customer_id text unique,
  square_card_id text,
  card_brand text,
  card_last4 text,
  card_exp text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  provider text not null,              -- 'uber-direct' | 'uber-mock'
  provider_quote_id text not null,
  kind text not null check (kind in ('pickup','delivery')),
  address jsonb not null,
  window_start timestamptz,
  fee_cents integer not null,
  eta_minutes integer not null,
  dropoff_eta timestamptz,
  distance_miles numeric(6,2),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  kind text not null check (kind in ('pickup','delivery')),
  status text not null default 'pending_payment',
  customer_id uuid not null references customers(id),
  address jsonb not null,
  unit text,
  instructions text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  items jsonb not null default '[]',
  notes text,
  ticket_number text,
  service_cents integer not null,
  discount_cents integer not null default 0,
  delivery_fee_cents integer not null,
  delivery_fee_waived boolean not null default false,
  total_cents integer not null,
  quote_id uuid references quotes(id),
  uber_mode text,
  uber_delivery_id text unique,
  uber_tracking_url text,
  uber_status text,
  courier jsonb,
  dispatch_error text,
  dispatched_at timestamptz,
  square_payment_id text unique,
  square_receipt_url text,
  payment_status text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookings_created_idx on bookings (created_at desc);

create table if not exists delivery_events (
  id bigserial primary key,
  booking_id uuid not null references bookings(id) on delete cascade,
  status text not null,
  detail text,
  at timestamptz not null default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  square_subscription_id text not null unique,
  plan_variation_id text not null,
  status text not null,                 -- pending | active | past_due | canceled
  card_id text,
  started_at timestamptz not null default now(),
  charged_through date,
  canceled_at timestamptz,
  cancel_effective date,
  last_invoice_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  booking_id uuid references bookings(id),
  membership_id uuid references memberships(id),
  kind text not null check (kind in ('booking','subscription')),
  square_payment_id text unique,
  square_invoice_id text,
  amount_cents integer not null,
  status text not null,
  receipt_url text,
  created_at timestamptz not null default now()
);
create unique index if not exists payments_invoice_status_uq on payments (square_invoice_id, status) where square_invoice_id is not null;

create table if not exists webhook_events (
  provider text not null,
  event_id text not null,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table if not exists notifications (
  id bigserial primary key,
  channel text not null check (channel in ('email','sms')),
  audience text not null check (audience in ('customer','owner')),
  to_addr text not null,
  subject text,
  body_text text not null,
  body_html text,
  provider text not null,              -- resend | twilio | outbox (no key configured)
  provider_id text,
  status text not null,
  error text,
  booking_id uuid references bookings(id) on delete set null,
  membership_id uuid references memberships(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists notifications_created_idx on notifications (created_at desc);

alter table bookings add column if not exists dispatched_at timestamptz;
