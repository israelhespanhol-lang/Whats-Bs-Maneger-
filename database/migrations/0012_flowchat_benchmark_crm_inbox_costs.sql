alter table public.conversations
  add column if not exists last_message_preview text,
  add column if not exists last_message_direction text,
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

alter table public.tags
  add column if not exists color text not null default '#8A96A3';

alter table public.message_templates
  add column if not exists is_favorite boolean not null default false;

create table if not exists public.crm_funnels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id uuid not null references public.crm_funnels(id) on delete cascade,
  name text not null,
  color text not null default '#8A96A3',
  position integer not null default 0,
  semantic_key text,
  is_terminal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funnel_id, name)
);

alter table public.conversations
  add column if not exists crm_stage_id uuid references public.crm_stages(id) on delete set null;

create index if not exists conversations_crm_stage_idx
  on public.conversations (crm_stage_id);
create index if not exists conversations_campaign_idx
  on public.conversations (campaign_id);
create index if not exists crm_funnels_org_idx
  on public.crm_funnels (organization_id, is_default desc, created_at);
create index if not exists crm_stages_funnel_position_idx
  on public.crm_stages (funnel_id, position);
create index if not exists tags_org_name_idx
  on public.tags (organization_id, name);

drop trigger if exists crm_funnels_set_updated_at on public.crm_funnels;
create trigger crm_funnels_set_updated_at
before update on public.crm_funnels
for each row execute function public.set_updated_at();

drop trigger if exists crm_stages_set_updated_at on public.crm_stages;
create trigger crm_stages_set_updated_at
before update on public.crm_stages
for each row execute function public.set_updated_at();

alter table public.crm_funnels enable row level security;
alter table public.crm_stages enable row level security;

drop policy if exists crm_funnels_member_all on public.crm_funnels;
create policy crm_funnels_member_all
  on public.crm_funnels for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists crm_stages_member_all on public.crm_stages;
create policy crm_stages_member_all
  on public.crm_stages for all to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

alter table public.broadcast_recipients
  add column if not exists meta_billable boolean,
  add column if not exists meta_pricing_category text,
  add column if not exists meta_pricing_model text,
  add column if not exists actual_cost_brl numeric(14,6);

alter table public.broadcasts
  add column if not exists actual_cost_brl numeric(14,6);

update public.conversations c
set
  last_message_preview = (
    select left(coalesce(m.body, '[' || m.message_type || ']'), 240)
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ),
  last_message_direction = (
    select m.direction
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  )
where c.last_message_preview is null;

do $$
declare
  org record;
  f_id uuid;
begin
  for org in select id from public.organizations loop
    select id into f_id
    from public.crm_funnels
    where organization_id = org.id and is_default = true
    order by created_at
    limit 1;

    if f_id is null then
      insert into public.crm_funnels (organization_id, name, is_default)
      values (org.id, 'Funil Comercial', true)
      returning id into f_id;
    end if;

    insert into public.crm_stages
      (organization_id, funnel_id, name, color, position, semantic_key, is_terminal)
    values
      (org.id, f_id, 'Novo', '#5B8DEF', 10, 'NEW', false),
      (org.id, f_id, 'Em atendimento', '#7A6FF0', 20, 'IN_SERVICE', false),
      (org.id, f_id, 'Interessado', '#18B77A', 30, 'INTERESTED', false),
      (org.id, f_id, 'Proposta enviada', '#D5A11E', 40, 'PROPOSAL', false),
      (org.id, f_id, 'Pagamento', '#E98239', 50, 'PAYMENT', false),
      (org.id, f_id, 'Venda concluída', '#24A148', 60, 'WON', true),
      (org.id, f_id, 'Recusado', '#D84C4C', 70, 'LOST', true),
      (org.id, f_id, 'Retomar contato', '#8A96A3', 80, 'FOLLOW_UP', false)
    on conflict (funnel_id, name) do nothing;
  end loop;
end $$;

update public.conversations c
set crm_stage_id = s.id
from public.contacts ct
join public.crm_funnels f
  on f.organization_id = ct.organization_id
 and f.is_default = true
join public.crm_stages s
  on s.funnel_id = f.id
where c.contact_id = ct.id
  and c.crm_stage_id is null
  and s.semantic_key = case ct.status
    when 'INTERESTED' then 'INTERESTED'
    when 'NEGOTIATION' then 'IN_SERVICE'
    when 'CUSTOMER' then 'WON'
    when 'NOT_INTERESTED' then 'LOST'
    else 'NEW'
  end;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='crm_funnels'
  ) then
    alter publication supabase_realtime add table public.crm_funnels;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='crm_stages'
  ) then
    alter publication supabase_realtime add table public.crm_stages;
  end if;
end $$;
