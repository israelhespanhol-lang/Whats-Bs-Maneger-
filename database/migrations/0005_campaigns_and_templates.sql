create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  category text not null default 'MARKETING'
    check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION', 'SERVICE')),
  language text not null default 'pt_BR',
  body text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED')),
  meta_template_name text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  objective text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'READY', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  template_id uuid references public.message_templates(id) on delete set null,
  audience_status text[] not null default array['LEAD']::text[],
  audience_count integer not null default 0 check (audience_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  delivered_count integer not null default 0 check (delivered_count >= 0),
  read_count integer not null default 0 check (read_count >= 0),
  replied_count integer not null default 0 check (replied_count >= 0),
  scheduled_at timestamptz,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_templates_org_status_idx
  on public.message_templates (organization_id, status, created_at desc);

create index if not exists campaigns_org_status_idx
  on public.campaigns (organization_id, status, created_at desc);

drop trigger if exists message_templates_set_updated_at on public.message_templates;
create trigger message_templates_set_updated_at
before update on public.message_templates
for each row execute function public.set_updated_at();

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

alter table public.message_templates enable row level security;
alter table public.campaigns enable row level security;

drop policy if exists message_templates_member_all on public.message_templates;
create policy message_templates_member_all
  on public.message_templates for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists campaigns_member_all on public.campaigns;
create policy campaigns_member_all
  on public.campaigns for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_templates'
  ) then
    alter publication supabase_realtime add table public.message_templates;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'campaigns'
  ) then
    alter publication supabase_realtime add table public.campaigns;
  end if;
end
$$;
