create table owner_password_resets (
  mobile text primary key references owner_users(mobile) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz
);