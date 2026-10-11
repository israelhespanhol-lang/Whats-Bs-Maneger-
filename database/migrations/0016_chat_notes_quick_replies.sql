-- Mais Chat phase 2: internal notes and shared quick replies. Neither sends WhatsApp messages.
create table if not exists public.conversation_internal_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_by_member_id uuid not null references public.organization_members(id),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists conversation_notes_conversation_created_idx
  on public.conversation_internal_notes (conversation_id, created_at desc);
alter table public.conversation_internal_notes enable row level security;
create policy conversation_notes_read on public.conversation_internal_notes
  for select to authenticated using (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.organization_id = organization_id
    )
  );
create policy conversation_notes_create on public.conversation_internal_notes
  for insert to authenticated with check (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.organization_id = organization_id
    )
    and exists (
      select 1 from public.organization_members m
      where m.id = created_by_member_id
        and m.organization_id = organization_id and m.user_id = auth.uid()
    )
  );

create table if not exists public.team_quick_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shortcut text not null check (shortcut ~ '^[a-z0-9_-]{2,30}$'),
  title text not null check (char_length(trim(title)) between 1 and 100),
  body text not null check (char_length(trim(body)) between 1 and 4096),
  created_by_member_id uuid not null references public.organization_members(id),
  created_at timestamptz not null default now(),
  unique (organization_id, shortcut)
);
create index if not exists team_quick_replies_org_idx on public.team_quick_replies (organization_id, shortcut);
alter table public.team_quick_replies enable row level security;
create policy team_quick_replies_read on public.team_quick_replies
  for select to authenticated using (public.is_org_member(organization_id));
create policy team_quick_replies_create on public.team_quick_replies
  for insert to authenticated with check (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.organization_members m
      where m.id = created_by_member_id
        and m.organization_id = organization_id and m.user_id = auth.uid()
    )
  );
create policy team_quick_replies_delete on public.team_quick_replies
  for delete to authenticated using (
    public.is_org_admin(organization_id)
    or exists (
      select 1 from public.organization_members m
      where m.id = created_by_member_id and m.user_id = auth.uid()
    )
  );

do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
    and tablename='conversation_internal_notes') then
      alter publication supabase_realtime add table public.conversation_internal_notes;
  end if;
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
    and tablename='team_quick_replies') then
      alter publication supabase_realtime add table public.team_quick_replies;
  end if;
end $$;
