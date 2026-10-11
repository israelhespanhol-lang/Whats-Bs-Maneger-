-- Phase 3: enforce a single responsible agent on outgoing messages.
-- Handles concurrent claims transactionally and verifies auth.uid() against membership.
create or replace function public.claim_conversation_for_reply(target_conversation uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  current_org uuid;
  owner_member uuid;
  sender_member uuid;
begin
  select c.organization_id,c.assigned_member_id into current_org,owner_member
  from public.conversations c where c.id=target_conversation for update;
  if current_org is null then return false; end if;

  select m.id into sender_member from public.organization_members m
  where m.organization_id=current_org and m.user_id=auth.uid()
  limit 1;
  if sender_member is null then return false; end if;

  if owner_member is null then
    update public.conversations
      set assigned_member_id=sender_member
      where id=target_conversation;
    return true;
  end if;
  return owner_member = sender_member;
end $$;
revoke all on function public.claim_conversation_for_reply(uuid) from public;
grant execute on function public.claim_conversation_for_reply(uuid) to authenticated;

create table if not exists public.conversation_assignment_history (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 from_member_id uuid references public.organization_members(id) on delete set null,
 to_member_id uuid references public.organization_members(id) on delete set null,
 changed_by_user_id uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists assignment_history_conversation_idx
 on public.conversation_assignment_history(conversation_id,created_at desc);
alter table public.conversation_assignment_history enable row level security;
create policy assignment_history_org_read
 on public.conversation_assignment_history for select to authenticated
 using (public.is_org_member(organization_id));

create or replace function public.record_conversation_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.assigned_member_id is distinct from new.assigned_member_id then
  insert into public.conversation_assignment_history
    (organization_id,conversation_id,from_member_id,to_member_id,changed_by_user_id)
  values (new.organization_id,new.id,old.assigned_member_id,new.assigned_member_id,auth.uid());
 end if;
 return new;
end $$;
drop trigger if exists conversations_assignment_audit on public.conversations;
create trigger conversations_assignment_audit
after update of assigned_member_id on public.conversations for each row
execute function public.record_conversation_assignment();
