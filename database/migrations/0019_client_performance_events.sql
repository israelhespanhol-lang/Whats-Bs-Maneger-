-- Phase 5: sampled, content-free performance telemetry.
create table if not exists public.client_performance_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_user_id uuid not null default auth.uid() references public.users(id) on delete cascade,
 operation text not null check (operation in ('INBOX_LOAD','MESSAGE_LOAD','SEND_MESSAGE')),
 duration_ms integer not null check (duration_ms >= 0 and duration_ms <= 120000),
 cache_hit boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists client_performance_org_date_idx
 on public.client_performance_events (organization_id,created_at desc);
alter table public.client_performance_events enable row level security;
create policy performance_events_owner_read on public.client_performance_events
 for select to authenticated using (public.is_org_admin(organization_id));
create policy performance_events_member_insert on public.client_performance_events
 for insert to authenticated with check (
  public.is_org_member(organization_id) and actor_user_id = auth.uid()
 );
