-- Dedicated memberships and invitation metadata for Mais Chat.
-- Never permit organization role changes directly from an authenticated browser.
drop policy if exists members_admin_all on public.organization_members;
drop policy if exists members_select on public.organization_members;
drop policy if exists members_select_org on public.organization_members;
create policy members_select_org
  on public.organization_members
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists users_select_org_colleagues on public.users;
create policy users_select_org_colleagues
  on public.users
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.user_id = users.id
        and public.is_org_member(om.organization_id)
    )
  );

create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('ADMIN','AGENT')),
  invited_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (organization_id, user_id)
);
create index if not exists team_invitations_org_idx on public.team_invitations (organization_id);

alter table public.team_invitations enable row level security;
-- No browser policies: only the Edge Function service-role credential can mutate invites.
