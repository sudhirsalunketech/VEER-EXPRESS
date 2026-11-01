-- Veer Express Courier — migration 0003: invoices, franchise commission and settlements
-- Additive. Business choices below are defaults that can be changed in company_settings / franchises:
--  * one company-wide invoice series per financial year (VX/26-27/00001), gapless
--  * invoices are NOT valid tax invoices until a GSTIN is configured (is_tax_invoice = false)
--  * franchise commission = franchises.commission_pct of freight excluding GST, accrued at booking
--  * settlements: created by finance, approved by a different admin (maker-checker), then marked paid

-- ---------------------------------------------------------------- company settings (single row)

create table company_settings (
  id           boolean primary key default true check (id),        -- exactly one row
  legal_name   text not null default 'Veer Express Courier',
  gstin        text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  address      text,
  state_code   char(2),
  invoice_prefix text not null default 'VX' check (invoice_prefix ~ '^[A-Z]{1,6}$'),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now()
);
insert into company_settings (id) values (true);

-- ---------------------------------------------------------------- invoices

alter table invoices add column is_tax_invoice boolean not null default false;
alter table invoices add column seller_legal_name text;
alter table invoices add column seller_gstin text;
create unique index invoices_shipment_uq on invoices(shipment_id) where shipment_id is not null;

create table invoice_counters (
  fy        text primary key,             -- '26-27'
  last_seq  bigint not null default 0
);

/** Indian financial year (April–March) of a timestamp, e.g. 2026-10-31 → '26-27'. */
create or replace function financial_year(p_at timestamptz) returns text language sql immutable as $$
  select case when extract(month from p_at at time zone 'Asia/Kolkata') >= 4
              then to_char(p_at at time zone 'Asia/Kolkata', 'YY') || '-' || to_char((p_at at time zone 'Asia/Kolkata') + interval '1 year', 'YY')
              else to_char((p_at at time zone 'Asia/Kolkata') - interval '1 year', 'YY') || '-' || to_char(p_at at time zone 'Asia/Kolkata', 'YY') end
$$;

/** Gapless company-wide invoice number for the financial year. Call inside the booking transaction. */
create or replace function next_invoice_no(p_at timestamptz) returns text language plpgsql as $$
declare v_fy text := financial_year(p_at); v_seq bigint; v_prefix text;
begin
  insert into invoice_counters (fy, last_seq) values (v_fy, 1)
  on conflict (fy) do update set last_seq = invoice_counters.last_seq + 1
  returning last_seq into v_seq;
  select invoice_prefix into v_prefix from company_settings;
  return v_prefix || '/' || v_fy || '/' || lpad(v_seq::text, 5, '0');
end $$;

-- issued invoices are never edited or deleted (credit notes come later)
create trigger invoices_append_only before update or delete on invoices for each row execute function forbid_change();

-- ---------------------------------------------------------------- settlements (maker-checker)

alter table settlements add column created_by uuid references users(id);
alter table settlements add column approved_at timestamptz;
alter table settlements add column paid_by uuid references users(id);
alter table settlements add column paid_reference text;
alter table settlements add constraint settlements_period_valid check (period_end >= period_start);
alter table settlements add constraint settlements_maker_checker check (approved_by is null or created_by is null or approved_by <> created_by);
alter table settlements add constraint settlements_approved check (status = 'DRAFT' or (approved_by is not null or is_demo));
alter table settlements add constraint settlements_paid check (status <> 'PAID' or (paid_at is not null and (paid_reference is not null or is_demo)));

alter table payments add column settlement_id uuid references settlements(id);
create index payments_settlement_idx on payments(settlement_id);
create index commissions_settlement_idx on commissions(settlement_id);

/** Status only moves forward; a paid settlement is final. */
create or replace function settlement_transition() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then raise exception 'Only draft settlements can be deleted' using errcode = '42501'; end if;
    return old;
  end if;
  if old.status = 'PAID' then raise exception 'Paid settlements cannot be changed' using errcode = '42501'; end if;
  if (old.status, new.status) not in (('DRAFT','DRAFT'), ('DRAFT','APPROVED'), ('APPROVED','APPROVED'), ('APPROVED','PAID')) then
    raise exception 'Invalid settlement transition % → %', old.status, new.status using errcode = '23514';
  end if;
  if new.status <> 'DRAFT' and (new.collections, new.commission, new.net_payable, new.period_start, new.period_end, new.branch_id)
     is distinct from (old.collections, old.commission, old.net_payable, old.period_start, old.period_end, old.branch_id) then
    raise exception 'Approved settlement amounts cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger settlements_transition before update or delete on settlements for each row execute function settlement_transition();

-- ---------------------------------------------------------------- ledger: company bank account

alter table ledger_entries drop constraint ledger_entries_account_check;
alter table ledger_entries add constraint ledger_entries_account_check check (account in (
  'CUSTOMER_RECEIVABLE', 'FREIGHT_REVENUE', 'GST_PAYABLE', 'BRANCH_CASH', 'GATEWAY_CLEARING', 'COURIER_COST', 'AGGREGATOR_PAYABLE',
  'FRANCHISE_WALLET', 'COMMISSION_EXPENSE', 'COMMISSION_PAYABLE', 'COMPANY_BANK'));
alter table ledger_entries add column settlement_id uuid references settlements(id);

-- ---------------------------------------------------------------- access

alter table company_settings enable row level security;
alter table invoice_counters enable row level security;
revoke all on company_settings, invoice_counters from anon, authenticated;
