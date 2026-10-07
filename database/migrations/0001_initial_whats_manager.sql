create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'AGENT'
    check (role in ('OWNER', 'ADMIN', 'AGENT')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  phone_number_id text not null,
  business_account_id text,
  display_phone_number text,
  verified_name text,
  status text not null default 'DISCONNECTED'
    check (status in ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_number_id)
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  phone_e164 text not null,
  name text,
  avatar_url text,
  status text not null default 'LEAD'
    check (status in ('LEAD', 'INTERESTED', 'NEGOTIATION', 'CUSTOMER', 'NOT_INTERESTED')),
  source text,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, phone_e164)
);

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  whatsapp_account_id uuid not null references whatsapp_accounts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  assigned_member_id uuid references organization_members(id) on delete set null,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'WAITING', 'RESOLVED')),
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  customer_service_window_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, whatsapp_account_id, contact_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  whatsapp_message_id text,
  reply_to_message_id uuid references messages(id) on delete set null,
  direction text not null check (direction in ('INBOUND', 'OUTBOUND')),
  message_type text not null default 'text',
  body text,
  media_url text,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
  error_code text,
  error_message text,
  raw_payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists messages_org_whatsapp_id_unique
  on messages (organization_id, whatsapp_message_id)
  where whatsapp_message_id is not null;

create index if not exists conversations_org_last_message_idx
  on conversations (organization_id, last_message_at desc nulls last);

create index if not exists messages_conversation_created_idx
  on messages (conversation_id, created_at asc);

create index if not exists contacts_org_name_idx
  on contacts (organization_id, name);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_set_updated_at on organizations;
create trigger organizations_set_updated_at
before update on organizations
for each row execute function set_updated_at();

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
before update on users
for each row execute function set_updated_at();

drop trigger if exists whatsapp_accounts_set_updated_at on whatsapp_accounts;
create trigger whatsapp_accounts_set_updated_at
before update on whatsapp_accounts
for each row execute function set_updated_at();

drop trigger if exists contacts_set_updated_at on contacts;
create trigger contacts_set_updated_at
before update on contacts
for each row execute function set_updated_at();

drop trigger if exists conversations_set_updated_at on conversations;
create trigger conversations_set_updated_at
before update on conversations
for each row execute function set_updated_at();
