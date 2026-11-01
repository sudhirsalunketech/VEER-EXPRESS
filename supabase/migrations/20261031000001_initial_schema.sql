-- Veer Express Courier — initial schema (PostgreSQL / Supabase)
-- Money: numeric(12,2) rupees. Timestamps: timestamptz. Soft delete via deleted_at where records are user-managed.
-- Courier credentials and payment secrets are server-side only; the anon/authenticated roles get NO access to them.

create extension if not exists pgcrypto;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------- access control
create table roles (
  id          text primary key,                       -- SUPER_ADMIN, ADMIN, BRANCH_MANAGER, ...
  name        text not null,
  is_global   boolean not null default false,          -- sees all branches
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table permissions (
  id          text primary key,                        -- e.g. shipments.read, partners.cost.read
  description text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table role_permissions (
  role_id       text not null references roles(id) on delete cascade,
  permission_id text not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- ---------------------------------------------------------------- organisation
create table franchises (
  id              uuid primary key default gen_random_uuid(),
  legal_name      text not null,
  owner_name      text not null,
  gstin           text,
  agreement_start date,
  commission_pct  numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create table branches (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                  -- BR-PUN
  name          text not null,
  franchise_id  uuid references franchises(id),        -- null = company-owned
  city          text not null,
  pin           char(6) not null check (pin ~ '^[1-9][0-9]{5}$'),
  address       text,
  phone         text,
  is_active     boolean not null default true,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index branches_franchise_idx on branches(franchise_id);

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  name           text not null,
  phone          text,
  password_hash  text not null,
  role_id        text not null references roles(id),
  branch_id      uuid references branches(id),
  is_active      boolean not null default true,
  last_login_at  timestamptz,
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create unique index users_email_uq on users(lower(email)) where deleted_at is null;
create index users_branch_idx on users(branch_id);

create table customers (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  phone         text not null,
  email         text,
  gstin         text,
  branch_id     uuid not null references branches(id),
  user_id       uuid references users(id),            -- optional customer-portal login
  credit_limit  numeric(12,2) not null default 0,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index customers_branch_idx on customers(branch_id);
create index customers_phone_idx on customers(phone);

-- ---------------------------------------------------------------- courier partners
create table courier_partners (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,            -- BLUEDART, TRACKON, DTDC, GENERIC_x, MOCK
  name                text not null,
  adapter             text not null,                   -- MockCourierProvider | BlueDartProvider | TrackonProvider | GenericCourierProvider
  api_base_url        text,
  auth_type           text not null default 'NONE' check (auth_type in ('NONE','API_KEY','BASIC','OAUTH2','JWT')),
  supports_booking    boolean not null default false,
  supports_tracking   boolean not null default false,
  supports_rates      boolean not null default false,
  supports_serviceability boolean not null default false,
  webhook_enabled     boolean not null default false,
  environment         text not null default 'TEST' check (environment in ('TEST','PRODUCTION')),
  is_enabled          boolean not null default false,
  priority            int not null default 100,
  volumetric_divisor  int not null default 5000 check (volumetric_divisor > 0),
  fuel_surcharge_pct  numeric(5,2) not null default 0,
  remote_area_surcharge numeric(12,2) not null default 0,
  status_map          jsonb not null default '{}'::jsonb, -- partner raw status -> unified status
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

-- secrets: encrypted by the API with CREDENTIAL_ENCRYPTION_KEY (AES-256-GCM). Never selected by client roles.
create table courier_credentials (
  id               uuid primary key default gen_random_uuid(),
  partner_id       uuid not null references courier_partners(id) on delete cascade,
  environment      text not null check (environment in ('TEST','PRODUCTION')),
  encrypted_payload bytea not null,
  key_version      int not null default 1,
  webhook_secret_encrypted bytea,
  rotated_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (partner_id, environment)
);

create table courier_rate_cards (
  id               uuid primary key default gen_random_uuid(),
  partner_id       uuid not null references courier_partners(id),
  zone             text not null check (zone in ('LOCAL','WITHIN_STATE','METRO','REST_OF_INDIA','SPECIAL')),
  service          text not null check (service in ('EXPRESS','STANDARD','SURFACE')),
  base_weight_kg   numeric(8,3) not null,
  base_price       numeric(12,2) not null,
  step_kg          numeric(8,3) not null check (step_kg > 0),
  additional_price numeric(12,2) not null,
  min_charge       numeric(12,2) not null default 0,
  tat_days         int not null,
  effective_from   date not null default current_date,
  effective_to     date,
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index rate_cards_lookup_idx on courier_rate_cards(partner_id, zone, service) where deleted_at is null;

create table courier_serviceability (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references courier_partners(id) on delete cascade,
  pin           char(6),                               -- exact PIN, or
  pin_prefix    text,                                  -- prefix rule
  is_serviceable boolean not null default true,
  is_remote     boolean not null default false,
  cod_available boolean not null default false,
  pickup_available boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (pin is not null or pin_prefix is not null)
);
create index serviceability_pin_idx on courier_serviceability(pin);
create index serviceability_prefix_idx on courier_serviceability(pin_prefix);

-- global pricing configuration (markup, GST, insurance). One active row.
create table pricing_settings (
  id             int primary key default 1 check (id = 1),
  markup_flat    numeric(12,2) not null default 0,
  markup_pct     numeric(5,2) not null default 0,
  insurance_pct  numeric(5,2) not null default 0,
  insurance_min  numeric(12,2) not null default 0,
  gst_pct        numeric(5,2) not null default 18,
  allocation_mode text not null default 'CHEAPEST' check (allocation_mode in ('MANUAL','CHEAPEST','RULE_BASED')),
  allocation_rules jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- shipments
create table shipments (
  id                 uuid primary key default gen_random_uuid(),
  tracking_number    text not null unique check (tracking_number ~ '^VX[0-9]{13}$'),
  branch_id          uuid not null references branches(id),
  customer_id        uuid references customers(id),
  created_by         uuid references users(id),
  service            text not null check (service in ('EXPRESS','STANDARD','SURFACE')),
  zone               text not null,
  status             text not null default 'BOOKED'
                     check (status in ('BOOKED','PICKED_UP','IN_TRANSIT','ARRIVED_AT_DESTINATION_HUB','OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','CANCELLED')),
  origin_pin         char(6) not null,
  dest_pin           char(6) not null,
  origin_city        text not null,
  dest_city          text not null,
  chargeable_weight_kg numeric(8,3) not null,
  volumetric_weight_kg numeric(8,3) not null,
  freight            numeric(12,2) not null,
  insurance_charge   numeric(12,2) not null default 0,
  gst                numeric(12,2) not null,
  total_amount       numeric(12,2) not null,
  -- internal-only economics (never returned by public endpoints)
  partner_id         uuid not null references courier_partners(id),
  partner_cost       numeric(12,2) not null,
  gross_margin       numeric(12,2) generated always as (freight - partner_cost) stored,
  allocation_mode    text not null,
  allocation_reason  text,
  estimated_delivery date,
  delivered_at       timestamptz,
  payment_mode       text not null check (payment_mode in ('UPI','ONLINE','CASH','COUNTER','CREDIT')),
  is_demo            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index shipments_branch_created_idx on shipments(branch_id, created_at desc);
create index shipments_status_idx on shipments(status);
create index shipments_customer_idx on shipments(customer_id);
create index shipments_partner_idx on shipments(partner_id);

create table shipment_addresses (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid not null references shipments(id) on delete cascade,
  kind         text not null check (kind in ('SENDER','RECEIVER')),
  name         text not null,
  phone        text not null,
  address      text not null,
  city         text,
  pin          char(6) not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (shipment_id, kind)
);

create table shipment_packages (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    uuid not null references shipments(id) on delete cascade,
  kind           text not null check (kind in ('DOCUMENT','PARCEL')),
  package_type   text not null,
  actual_weight_kg numeric(8,3) not null check (actual_weight_kg > 0),
  length_cm      numeric(8,2) not null, width_cm numeric(8,2) not null, height_cm numeric(8,2) not null,
  declared_value numeric(12,2) not null default 0,
  insured        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index shipment_packages_shipment_idx on shipment_packages(shipment_id);

create table shipment_tracking_events (
  id            bigint generated always as identity primary key,
  shipment_id   uuid not null references shipments(id) on delete cascade,
  status        text not null,
  location      text,
  note          text,
  occurred_at   timestamptz not null,
  source        text not null check (source in ('SYSTEM','STAFF','PARTNER_WEBHOOK','PARTNER_POLL','DEMO')),
  raw_status    text,                                   -- partner raw status (internal)
  created_at    timestamptz not null default now()
);
create index tracking_events_shipment_idx on shipment_tracking_events(shipment_id, occurred_at);

create table courier_awb_mappings (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null unique references shipments(id) on delete cascade,
  partner_id    uuid not null references courier_partners(id),
  partner_awb   text,
  label_url     text,
  manifest_ref  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (partner_id, partner_awb)
);

-- ---------------------------------------------------------------- finance
create table payments (
  id              uuid primary key default gen_random_uuid(),
  shipment_id     uuid references shipments(id),
  branch_id       uuid not null references branches(id),
  mode            text not null check (mode in ('UPI','ONLINE','CASH','COUNTER','CREDIT','WALLET')),
  direction       text not null default 'IN' check (direction in ('IN','REFUND')),
  amount          numeric(12,2) not null check (amount >= 0),
  status          text not null check (status in ('PENDING','CAPTURED','FAILED','REFUNDED','SIMULATED')),
  gateway         text,                                  -- RAZORPAY | SIMULATED | null
  gateway_order_id text,
  gateway_payment_id text,                               -- references only; NO card data is ever stored
  collected_by    uuid references users(id),
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index payments_branch_idx on payments(branch_id, created_at desc);
create unique index payments_gateway_payment_uq on payments(gateway, gateway_payment_id) where gateway_payment_id is not null;

create table invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  branch_id      uuid not null references branches(id),
  customer_id    uuid references customers(id),
  shipment_id    uuid references shipments(id),
  taxable_value  numeric(12,2) not null,
  cgst           numeric(12,2) not null default 0,
  sgst           numeric(12,2) not null default 0,
  igst           numeric(12,2) not null default 0,
  total          numeric(12,2) not null,
  issued_at      timestamptz not null default now(),
  is_demo        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index invoices_branch_idx on invoices(branch_id, issued_at desc);

create table wallets (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null unique references branches(id),
  balance     numeric(12,2) not null default 0,
  low_balance_threshold numeric(12,2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table wallet_transactions (
  id           bigint generated always as identity primary key,
  wallet_id    uuid not null references wallets(id),
  kind         text not null check (kind in ('TOPUP','SHIPMENT_DEBIT','REFUND_CREDIT','COMMISSION_CREDIT','ADJUSTMENT')),
  amount       numeric(12,2) not null,                  -- signed
  balance_after numeric(12,2) not null,
  shipment_id  uuid references shipments(id),
  reference    text,
  created_by   uuid references users(id),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index wallet_tx_wallet_idx on wallet_transactions(wallet_id, created_at desc);

create table settlements (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id),
  period_start  date not null,
  period_end    date not null,
  collections   numeric(12,2) not null default 0,
  commission    numeric(12,2) not null default 0,
  net_payable   numeric(12,2) not null default 0,
  status        text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','PAID')),
  approved_by   uuid references users(id),
  paid_at       timestamptz,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_end >= period_start)
);
create index settlements_branch_idx on settlements(branch_id, period_end desc);

create table commissions (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id),
  shipment_id   uuid not null unique references shipments(id),
  base_amount   numeric(12,2) not null,
  pct           numeric(5,2) not null,
  amount        numeric(12,2) not null,
  settlement_id uuid references settlements(id),
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index commissions_branch_idx on commissions(branch_id);

-- ---------------------------------------------------------------- logs
create table notification_logs (
  id           bigint generated always as identity primary key,
  shipment_id  uuid references shipments(id),
  channel      text not null check (channel in ('WHATSAPP','SMS','EMAIL')),
  template     text not null,
  recipient    text not null,                          -- masked where displayed
  status       text not null check (status in ('QUEUED','SENT','FAILED','SIMULATED')),
  provider_ref text,
  error        text,
  created_at   timestamptz not null default now()
);
create index notification_logs_shipment_idx on notification_logs(shipment_id);

create table audit_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references users(id),
  action      text not null,
  entity      text not null,
  entity_id   text,
  detail      jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx on audit_logs(entity, entity_id);
create index audit_logs_created_idx on audit_logs(created_at desc);

-- ---------------------------------------------------------------- triggers
do $$ declare t text; begin
  for t in select unnest(array['roles','permissions','franchises','branches','users','customers','courier_partners','courier_credentials',
    'courier_rate_cards','courier_serviceability','shipments','shipment_addresses','shipment_packages','courier_awb_mappings',
    'payments','invoices','wallets','settlements','commissions'])
  loop execute format('create trigger %I_updated before update on %I for each row execute function set_updated_at()', t, t); end loop;
end $$;

-- ---------------------------------------------------------------- row level security
-- The NestJS API connects as a privileged role and enforces scoping in code (defence layer 1).
-- RLS is enabled on every table so that Supabase anon/authenticated keys can read nothing by default (defence layer 2).
-- If direct Supabase client access is ever introduced, add policies keyed on auth.jwt() ->> 'branch_id'.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
revoke all on courier_credentials from anon, authenticated;
