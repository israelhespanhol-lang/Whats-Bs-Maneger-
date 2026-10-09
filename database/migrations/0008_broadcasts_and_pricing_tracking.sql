create table if not exists public.whatsapp_pricing_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  unit_cost_brl numeric(12,6) not null default 0 check (unit_cost_brl >= 0),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, category)
);

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  template_id uuid not null references public.message_templates(id) on delete restrict,
  category text not null check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  audience_status text[] not null default array['LEAD']::text[],
  audience_count integer not null default 0 check (audience_count >= 0),
  status text not null default 'DRAFT'
    check (status in ('DRAFT','READY','SENDING','PAUSED','COMPLETED','CANCELED')),
  unit_cost_brl numeric(12,6) not null default 0 check (unit_cost_brl >= 0),
  estimated_cost_brl numeric(14,6) not null default 0 check (estimated_cost_brl >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  delivered_count integer not null default 0 check (delivered_count >= 0),
  read_count integer not null default 0 check (read_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  opt_in_confirmed boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  phone_e164 text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','SENT','DELIVERED','READ','FAILED','SKIPPED')),
  whatsapp_message_id text,
  estimated_cost_brl numeric(12,6) not null default 0 check (estimated_cost_brl >= 0),
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broadcast_id, contact_id)
);

create index if not exists broadcasts_org_created_idx
  on public.broadcasts (organization_id, created_at desc);
create index if not exists broadcasts_template_idx
  on public.broadcasts (template_id);
create index if not exists broadcasts_created_by_idx
  on public.broadcasts (created_by);
create index if not exists broadcast_recipients_broadcast_status_idx
  on public.broadcast_recipients (broadcast_id, status);
create index if not exists broadcast_recipients_contact_idx
  on public.broadcast_recipients (contact_id);

drop trigger if exists whatsapp_pricing_rates_set_updated_at on public.whatsapp_pricing_rates;
create trigger whatsapp_pricing_rates_set_updated_at
before update on public.whatsapp_pricing_rates
for each row execute function public.set_updated_at();

drop trigger if exists broadcasts_set_updated_at on public.broadcasts;
create trigger broadcasts_set_updated_at
before update on public.broadcasts
for each row execute function public.set_updated_at();

drop trigger if exists broadcast_recipients_set_updated_at on public.broadcast_recipients;
create trigger broadcast_recipients_set_updated_at
before update on public.broadcast_recipients
for each row execute function public.set_updated_at();

alter table public.whatsapp_pricing_rates enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;

drop policy if exists whatsapp_pricing_rates_member_all on public.whatsapp_pricing_rates;
create policy whatsapp_pricing_rates_member_all
  on public.whatsapp_pricing_rates for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists broadcasts_member_all on public.broadcasts;
create policy broadcasts_member_all
  on public.broadcasts for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists broadcast_recipients_member_all on public.broadcast_recipients;
create policy broadcast_recipients_member_all
  on public.broadcast_recipients for all to authenticated
  using (
    exists (
      select 1
      from public.broadcasts b
      where b.id = broadcast_recipients.broadcast_id
        and public.is_org_member(b.organization_id)
    )
  )
  with check (
    exists (
      select 1
      from public.broadcasts b
      where b.id = broadcast_recipients.broadcast_id
        and public.is_org_member(b.organization_id)
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='broadcasts'
  ) then
    alter publication supabase_realtime add table public.broadcasts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='broadcast_recipients'
  ) then
    alter publication supabase_realtime add table public.broadcast_recipients;
  end if;
end
$$;
