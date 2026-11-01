-- Veer Express Courier — migration 0002: aggregator model & manual operations
-- Business model: courier bookings are made in an external AGGREGATOR account; staff record the
-- aggregator reference, courier and AWB in Veer. Tracking is entered manually by staff, with audit.
-- Payment status is independent of shipment status. Money movements go to an append-only ledger.
-- This migration is additive: no existing column is dropped and existing data is carried over.

-- ---------------------------------------------------------------- aggregators

create table aggregators (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  mode        text not null default 'MANUAL' check (mode in ('MANUAL', 'API')),
  portal_url  text,                                  -- link staff open to book; no credentials stored for MANUAL
  is_enabled  boolean not null default true,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger aggregators_updated before update on aggregators for each row execute function set_updated_at();

-- ---------------------------------------------------------------- shipments: courier is not known at booking

alter table shipments alter column partner_id drop not null;
alter table shipments alter column partner_cost drop not null;
alter table shipments alter column allocation_mode set default 'MANUAL';
alter table shipments add column estimated_partner_cost numeric(12,2);   -- rate-card hint at booking time

-- gross_margin was generated from partner_cost; recompute so it is null until allocated
alter table shipments drop column gross_margin;
alter table shipments add column gross_margin numeric(12,2) generated always as (freight - partner_cost) stored;

-- ---------------------------------------------------------------- allocation history

create table shipment_allocations (
  id              uuid primary key default gen_random_uuid(),
  shipment_id     uuid not null references shipments(id) on delete cascade,
  aggregator_id   uuid not null references aggregators(id),
  aggregator_ref  text not null check (aggregator_ref ~ '^[A-Za-z0-9][A-Za-z0-9/_-]{3,39}$'),
  courier_name    text not null check (length(trim(courier_name)) >= 2),
  partner_id      uuid references courier_partners(id),          -- optional link to a known courier
  awb             text not null check (awb ~ '^[A-Z0-9-]{6,30}$'),
  partner_cost    numeric(12,2) not null check (partner_cost > 0),
  allocated_by    uuid references users(id),
  allocated_at    timestamptz not null default now(),
  superseded_at   timestamptz,                                    -- set when re-allocated
  superseded_by   uuid references users(id),
  supersede_reason text,
  created_at      timestamptz not null default now(),
  check (superseded_by is null or superseded_at is not null)
);
-- exactly one active allocation per shipment; an AWB is active on at most one shipment per courier
create unique index shipment_allocations_active_uq on shipment_allocations(shipment_id) where superseded_at is null;
create unique index shipment_allocations_awb_uq on shipment_allocations(lower(courier_name), awb) where superseded_at is null;
create index shipment_allocations_ref_idx on shipment_allocations(aggregator_id, aggregator_ref);

-- carry over existing AWB mappings as allocations from a legacy aggregator record
insert into aggregators (code, name, mode, is_enabled) values ('LEGACY', 'Legacy partner mapping', 'MANUAL', false);
insert into shipment_allocations (shipment_id, aggregator_id, aggregator_ref, courier_name, partner_id, awb, partner_cost, allocated_at)
select m.shipment_id, (select id from aggregators where code = 'LEGACY'), 'LEGACY-' || left(replace(m.id::text, '-', ''), 12),
       p.name, m.partner_id, upper(m.partner_awb), s.partner_cost, m.created_at
  from courier_awb_mappings m
  join courier_partners p on p.id = m.partner_id
  join shipments s on s.id = m.shipment_id
 where m.partner_awb is not null and upper(m.partner_awb) ~ '^[A-Z0-9-]{6,30}$' and s.partner_cost > 0;

-- ---------------------------------------------------------------- tracking audit

alter table shipment_tracking_events drop constraint shipment_tracking_events_source_check;
alter table shipment_tracking_events add constraint shipment_tracking_events_source_check
  check (source in ('SYSTEM', 'STAFF', 'MANUAL', 'API', 'PARTNER_WEBHOOK', 'PARTNER_POLL', 'DEMO'));
alter table shipment_tracking_events add column recorded_at timestamptz not null default now();
alter table shipment_tracking_events add column recorded_by uuid references users(id);
alter table shipment_tracking_events add column verified boolean not null default false;
update shipment_tracking_events set recorded_at = greatest(created_at, occurred_at);
-- the event cannot have happened after it was recorded (5-minute clock tolerance)
alter table shipment_tracking_events add constraint tracking_event_not_future check (occurred_at <= recorded_at + interval '5 minutes');
-- manual entries must name the staff member and be verified against the courier site
alter table shipment_tracking_events add constraint tracking_manual_audited
  check (source <> 'MANUAL' or (recorded_by is not null and verified));
create index tracking_events_recorded_idx on shipment_tracking_events(shipment_id, recorded_at desc);

-- ---------------------------------------------------------------- payments & receipts

alter table payments drop constraint payments_mode_check;
alter table payments add constraint payments_mode_check
  check (mode in ('UPI', 'ONLINE', 'CASH', 'COUNTER', 'COUNTER_UPI', 'COUNTER_CARD', 'CREDIT', 'WALLET'));
alter table payments add column receipt_no text;
alter table payments add column reference text;               -- UPI txn id / card slip no.
create unique index payments_receipt_uq on payments(branch_id, receipt_no) where receipt_no is not null;
-- counter collections must say who collected them and carry a receipt number
alter table payments add constraint payments_counter_audited
  check (mode not in ('CASH', 'COUNTER_UPI', 'COUNTER_CARD') or status <> 'CAPTURED' or (collected_by is not null and receipt_no is not null));

create table branch_receipt_counters (
  branch_id  uuid primary key references branches(id),
  last_seq   bigint not null default 0
);

/** Gapless per-branch receipt numbers, e.g. PUN-R-000012. Call inside the collection transaction. */
create or replace function next_receipt_no(p_branch uuid) returns text language plpgsql as $$
declare v_seq bigint; v_code text;
begin
  insert into branch_receipt_counters (branch_id, last_seq) values (p_branch, 1)
  on conflict (branch_id) do update set last_seq = branch_receipt_counters.last_seq + 1
  returning last_seq into v_seq;
  select regexp_replace(code, '^BR-', '') into v_code from branches where id = p_branch;
  return v_code || '-R-' || lpad(v_seq::text, 6, '0');
end $$;

/** Payment status derived from payment rows only — never stored on, or inferred from, the shipment status. */
create view shipment_payment_summary as
select s.id as shipment_id,
       s.total_amount,
       coalesce(sum(p.amount) filter (where p.direction = 'IN' and p.status in ('CAPTURED', 'SIMULATED')), 0) as received,
       coalesce(sum(p.amount) filter (where p.direction = 'REFUND' and p.status in ('CAPTURED', 'SIMULATED', 'REFUNDED')), 0) as refunded,
       case
         when coalesce(sum(p.amount) filter (where p.direction = 'REFUND'), 0) > 0
              and coalesce(sum(p.amount) filter (where p.direction = 'REFUND'), 0)
                  >= coalesce(sum(p.amount) filter (where p.direction = 'IN' and p.status in ('CAPTURED', 'SIMULATED')), 0) then 'REFUNDED'
         when coalesce(sum(p.amount) filter (where p.direction = 'IN' and p.status in ('CAPTURED', 'SIMULATED')), 0) <= 0 then 'PENDING'
         when coalesce(sum(p.amount) filter (where p.direction = 'IN' and p.status in ('CAPTURED', 'SIMULATED')), 0)
              - coalesce(sum(p.amount) filter (where p.direction = 'REFUND'), 0) + 0.005 >= s.total_amount then 'PAID'
         else 'PARTIALLY_PAID'
       end as payment_status
  from shipments s
  left join payments p on p.shipment_id = s.id
 group by s.id, s.total_amount;

-- ---------------------------------------------------------------- ledger (append-only, double-entry)

create table ledger_entries (
  id          bigint generated always as identity primary key,
  journal_id  uuid not null,                         -- all lines of one business event share a journal
  posted_at   timestamptz not null default now(),
  account     text not null check (account in (
                'CUSTOMER_RECEIVABLE', 'FREIGHT_REVENUE', 'GST_PAYABLE', 'BRANCH_CASH', 'GATEWAY_CLEARING',
                'COURIER_COST', 'AGGREGATOR_PAYABLE', 'FRANCHISE_WALLET', 'COMMISSION_EXPENSE', 'COMMISSION_PAYABLE')),
  debit       numeric(12,2) not null default 0 check (debit >= 0),
  credit      numeric(12,2) not null default 0 check (credit >= 0),
  branch_id   uuid not null references branches(id),
  shipment_id uuid references shipments(id),
  payment_id  uuid references payments(id),
  memo        text not null,
  reversal_of bigint references ledger_entries(id),  -- corrections are reversals, never edits
  created_by  uuid references users(id),
  is_demo     boolean not null default false,
  check ((debit > 0) <> (credit > 0))                 -- exactly one side per line
);
create index ledger_journal_idx on ledger_entries(journal_id);
create index ledger_branch_account_idx on ledger_entries(branch_id, account, posted_at);
create index ledger_shipment_idx on ledger_entries(shipment_id);

/** Every journal must balance. Checked at commit, so all lines of a journal can be inserted first. */
create or replace function ledger_journal_balanced() returns trigger language plpgsql as $$
declare v_diff numeric;
begin
  select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) into v_diff from ledger_entries where journal_id = new.journal_id;
  if abs(v_diff) >= 0.01 then
    raise exception 'Ledger journal % is not balanced (debit - credit = %)', new.journal_id, v_diff using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger ledger_balanced after insert on ledger_entries
  deferrable initially deferred for each row execute function ledger_journal_balanced();

-- ---------------------------------------------------------------- append-only protection

create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only: % is not allowed (post a reversal instead)', tg_table_name, tg_op using errcode = '42501';
end $$;
create trigger ledger_entries_append_only before update or delete on ledger_entries for each row execute function forbid_change();
create trigger audit_logs_append_only before update or delete on audit_logs for each row execute function forbid_change();
create trigger tracking_events_append_only before update or delete on shipment_tracking_events for each row execute function forbid_change();
create trigger wallet_tx_append_only before update or delete on wallet_transactions for each row execute function forbid_change();

-- ---------------------------------------------------------------- access

alter table aggregators enable row level security;
alter table shipment_allocations enable row level security;
alter table branch_receipt_counters enable row level security;
alter table ledger_entries enable row level security;
revoke all on shipment_allocations, ledger_entries, branch_receipt_counters from anon, authenticated;
revoke all on shipment_payment_summary from anon, authenticated;
