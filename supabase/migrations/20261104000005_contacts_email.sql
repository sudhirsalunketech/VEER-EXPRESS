-- Veer Express Courier — migration 0005: optional e-mail on addresses + branch address book
-- The address book is for counter staff only (branch-scoped in the API). It is never exposed publicly.

alter table shipment_addresses add column email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create table contacts (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branches(id),
  name         text not null,
  phone        text not null check (phone ~ '^[6-9][0-9]{9}$'),
  email        text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address      text not null,
  pin          char(6) not null check (pin ~ '^[1-9][0-9]{5}$'),
  use_count    integer not null default 1,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  -- one entry per person per branch; the latest address and e-mail win
  unique (branch_id, phone, name)
);
create index contacts_branch_name_idx on contacts(branch_id, lower(name) text_pattern_ops);
create index contacts_branch_phone_idx on contacts(branch_id, phone text_pattern_ops);

alter table contacts enable row level security;
revoke all on contacts from anon, authenticated;
