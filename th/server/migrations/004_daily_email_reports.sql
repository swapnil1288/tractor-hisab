alter table businesses
  add column report_email text,
  add column daily_report_enabled boolean not null default false;

create table daily_email_reports (
  business_id uuid not null references businesses(id) on delete cascade,
  report_date date not null,
  recipient text not null,
  payload jsonb not null,
  status text not null check (
    status in ('sending', 'accepted', 'failed', 'unknown')
  ),
  message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (business_id, report_date)
);