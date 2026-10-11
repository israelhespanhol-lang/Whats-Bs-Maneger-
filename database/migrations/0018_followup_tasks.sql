-- Phase 4: safe, in-app follow-up tasks. No automatic WhatsApp sends.
create table if not exists public.conversation_followup_tasks (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 note text not null check (char_length(trim(note)) between 1 and 1500),
 due_at timestamptz not null,
 status text not null default 'PENDING' check (status in ('PENDING','DONE','CANCELLED')),
 created_by_member_id uuid references public.organization_members(id) on delete set null,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
create index if not exists conversation_followups_due_idx
 on public.conversation_followup_tasks (organization_id,status,due_at);
create index if not exists conversation_followups_conversation_idx
 on public.conversation_followup_tasks (conversation_id,due_at);
alter table public.conversation_followup_tasks enable row level security;
create policy conversation_followups_read on public.conversation_followup_tasks
 for select to authenticated using (public.is_org_member(organization_id));
create policy conversation_followups_create on public.conversation_followup_tasks
 for insert to authenticated with check (
 public.is_org_member(organization_id)
 and status='PENDING'
 and exists(select 1 from public.conversations c
  where c.id=conversation_id and c.organization_id=organization_id)
 and exists(select 1 from public.organization_members m
  where m.id=created_by_member_id and m.user_id=auth.uid() and m.organization_id=organization_id)
);
create policy conversation_followups_update on public.conversation_followup_tasks
 for update to authenticated
 using (public.is_org_member(organization_id))
 with check (
 public.is_org_member(organization_id)
 and exists(select 1 from public.conversations c
  where c.id=conversation_id and c.organization_id=organization_id)
);
do $$
begin
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
 and schemaname='public' and tablename='conversation_followup_tasks') then
  alter publication supabase_realtime add table public.conversation_followup_tasks;
 end if;
end $$;
