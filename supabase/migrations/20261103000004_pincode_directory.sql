-- Veer Express Courier — migration 0004: PIN code directory
-- Optional local copy of the India Post "All India Pincode Directory" (free open data, data.gov.in).
-- Load it with: npm run db:import-pincodes -w apps/api -- <path-to-csv>
-- When a PIN is not in this table the API falls back to the free India Post lookup service.

create table pincode_directory (
  pin          char(6) not null check (pin ~ '^[1-9][0-9]{5}$'),
  office_name  text not null,
  office_type  text,                         -- HO / SO / BO
  delivery     boolean not null default true,
  district     text not null,
  state        text not null,
  source       text not null default 'INDIA_POST_CSV',
  updated_at   timestamptz not null default now(),
  primary key (pin, office_name)
);
create index pincode_directory_pin_idx on pincode_directory(pin);

alter table pincode_directory enable row level security;
-- public, non-personal reference data: readable by anyone, writable only by the service role
create policy pincode_directory_read on pincode_directory for select using (true);
revoke insert, update, delete on pincode_directory from anon, authenticated;
