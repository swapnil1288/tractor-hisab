-- Tractor Hisab initial schema. Money = integer paise (BIGINT). Times = timestamptz.
create extension if not exists pgcrypto;

create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  owner_name text not null check (length(owner_name) between 1 and 120),
  village text, upi text, lang text not null default 'mr' check (lang in ('mr','hi','en')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table owner_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  mobile text not null unique check (mobile ~ '^[6-9][0-9]{9}$'),
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  id text primary key,                         -- sha256 of the cookie token, never the token itself
  kind text not null check (kind in ('owner','farmer')),
  owner_user_id uuid references owner_users(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  farmer_mobile text,
  selected_farmer_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_expires on sessions(expires_at);

create table tractors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table implements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  rate_type text not null check (rate_type in ('hour','acre','trip','fixed')),
  rate_paise bigint not null check (rate_paise > 0),
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table farmers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  village text,
  mobile text check (mobile is null or mobile ~ '^[6-9][0-9]{9}$'),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index farmers_business on farmers(business_id);
create index farmers_mobile on farmers(mobile) where mobile is not null;

create table farms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  farmer_id uuid not null references farmers(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (farmer_id, name)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  farmer_id uuid not null references farmers(id),
  farm_id uuid references farms(id),
  tractor_id uuid references tractors(id),
  implement_id uuid references implements(id),
  implement_name text not null,                    -- snapshot: exact name at time of work
  rate_type text not null check (rate_type in ('hour','acre','trip','fixed')),
  standard_rate_paise bigint not null check (standard_rate_paise > 0), -- implement rate when booked
  applied_rate_paise bigint not null check (applied_rate_paise > 0),   -- rate used for this job
  rate_override_reason text,
  status text not null check (status in ('booked','running','completed','confirmed','cancelled','superseded')),
  scheduled_date date,
  start_at timestamptz, end_at timestamptz,
  break_minutes int not null default 0 check (break_minutes >= 0),
  qty_hundredths int check (qty_hundredths is null or qty_hundredths > 0),
  meter_start numeric(9,2), meter_end numeric(9,2),
  meter_reset boolean not null default false, meter_note text,
  billable_minutes int, charge_paise bigint,
  note text,
  corrected_from uuid references jobs(id),
  cancel_reason text,
  confirmed_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (applied_rate_paise = standard_rate_paise or rate_override_reason is not null),
  check (status <> 'confirmed' or (charge_paise is not null and confirmed_at is not null))
);
create index jobs_business_farmer on jobs(business_id, farmer_id);

create table payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  farmer_id uuid not null references farmers(id),
  amount_paise bigint not null check (amount_paise > 0),
  mode text not null check (mode in ('cash','upi','cheque','other')),
  reference text, paid_on date not null, note text,
  status text not null default 'active' check (status in ('active','voided')),
  void_reason text,
  created_at timestamptz not null default now()
);

-- Append-only money ledger. charge = +, payment = -, reversal = negation of an earlier entry.
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  farmer_id uuid not null references farmers(id),
  kind text not null check (kind in ('charge','payment','reversal')),
  amount_paise bigint not null check (amount_paise <> 0),
  job_id uuid references jobs(id),
  payment_id uuid references payments(id),
  reverses_id uuid unique references ledger_entries(id),
  entry_date date not null,
  memo text,
  created_at timestamptz not null default now()
);
create unique index ledger_one_charge_per_job on ledger_entries(job_id) where kind = 'charge';
create unique index ledger_one_entry_per_payment on ledger_entries(payment_id) where kind = 'payment';
create index ledger_farmer on ledger_entries(business_id, farmer_id, entry_date);

create table statements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  farmer_id uuid not null references farmers(id),
  kind text not null check (kind in ('all','range','since_last')),
  from_date date, to_date date not null,
  opening_paise bigint not null, closing_paise bigint not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index statements_farmer on statements(business_id, farmer_id, created_at);

create table audit_log (
  id bigserial primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  actor text not null, action text not null, entity text not null, entity_id uuid,
  before jsonb, after jsonb, reason text,
  created_at timestamptz not null default now()
);

-- Idempotency: every mutating request carries a client-generated key; replays return the stored result.
create table applied_ops (
  op_id uuid primary key,
  business_id uuid references businesses(id) on delete cascade,
  status int, response jsonb,
  created_at timestamptz not null default now()
);

create table farmer_otps (
  id uuid primary key default gen_random_uuid(),
  mobile text not null, code_hash text not null,
  expires_at timestamptz not null, attempts int not null default 0, consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index farmer_otps_mobile on farmer_otps(mobile, created_at);

create table farmer_questions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  farmer_id uuid not null references farmers(id),
  message text not null check (length(message) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table rate_limits (key text not null, at timestamptz not null default now());
create index rate_limits_key on rate_limits(key, at);

-- Financial history cannot be edited or deleted, only reversed.
create or replace function forbid_change() returns trigger language plpgsql as $$
begin raise exception 'append-only table %: % not allowed', tg_table_name, tg_op; end $$;
create trigger ledger_append_only before update or delete on ledger_entries for each row execute function forbid_change();
create trigger audit_append_only before update or delete on audit_log for each row execute function forbid_change();
