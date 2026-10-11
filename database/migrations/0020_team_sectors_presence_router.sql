-- Mais Chat | Etapa 3: setores, presença, supervisão e distribuição segura.
-- Padrão: roteamento desativado. Só atua em mensagens novas após ativação do administrador.
create table if not exists public.team_departments (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check (length(btrim(name)) between 2 and 60),
 created_at timestamptz not null default now(),
 unique (organization_id, name),
 unique (id, organization_id)
);
create table if not exists public.team_department_members (
 member_id uuid primary key references public.organization_members(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 department_id uuid not null,
 created_at timestamptz not null default now(),
 foreign key (department_id, organization_id) references public.team_departments(id, organization_id) on delete cascade
);
create index if not exists team_department_members_org_idx on public.team_department_members(organization_id, department_id);

create table if not exists public.team_member_presence (
 member_id uuid primary key references public.organization_members(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 status text not null default 'OFFLINE' check (status in ('AVAILABLE','AWAY','OFFLINE')),
 last_seen_at timestamptz not null default now(),
 last_assigned_at timestamptz,
 updated_at timestamptz not null default now()
);
create index if not exists team_presence_queue_idx on public.team_member_presence(organization_id,status,last_seen_at);

create table if not exists public.team_routing_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 enabled boolean not null default false,
 default_department_id uuid,
 updated_at timestamptz not null default now(),
 foreign key (default_department_id,organization_id) references public.team_departments(id,organization_id) on delete set null
);
-- ON DELETE SET NULL on composite FK could clear organization_id; replace with
-- explicit administration requirement: a department in use cannot be deleted.
alter table public.team_routing_settings drop constraint if exists team_routing_settings_default_department_id_organization_id_fkey;
alter table public.team_routing_settings
 add constraint team_routing_settings_department_fk
 foreign key (default_department_id, organization_id)
 references public.team_departments(id, organization_id) on delete no action;

alter table public.team_departments enable row level security;
alter table public.team_department_members enable row level security;
alter table public.team_member_presence enable row level security;
alter table public.team_routing_settings enable row level security;

create policy team_departments_read on public.team_departments
 for select to authenticated using (public.is_org_member(organization_id));
create policy team_departments_write on public.team_departments
 for all to authenticated using (public.is_org_admin(organization_id))
 with check (public.is_org_admin(organization_id));

create policy team_department_members_read on public.team_department_members
 for select to authenticated using (public.is_org_member(organization_id));
create policy team_department_members_write on public.team_department_members
 for all to authenticated using (public.is_org_admin(organization_id))
 with check (
  public.is_org_admin(organization_id)
  and exists(select 1 from public.organization_members m
    where m.id=member_id and m.organization_id=team_department_members.organization_id)
 );

create policy team_presence_read on public.team_member_presence
 for select to authenticated using (public.is_org_member(organization_id));
create policy team_presence_insert on public.team_member_presence
 for insert to authenticated with check (exists(
   select 1 from public.organization_members m
   where m.id=member_id and m.organization_id=team_member_presence.organization_id
    and m.user_id=auth.uid()
 ));
create policy team_presence_update on public.team_member_presence
 for update to authenticated using (exists(
   select 1 from public.organization_members m where m.id=member_id and m.user_id=auth.uid()
 ))
 with check (exists(
   select 1 from public.organization_members m
   where m.id=member_id and m.organization_id=team_member_presence.organization_id
     and m.user_id=auth.uid()
 ));

create policy team_routing_read on public.team_routing_settings
 for select to authenticated using (public.is_org_member(organization_id));
create policy team_routing_admin_write on public.team_routing_settings
 for all to authenticated using (public.is_org_admin(organization_id))
 with check (public.is_org_admin(organization_id));

-- Never allow a member to fabricate being AVAILABLE with a fresh presence
-- and an arbitrary last_assigned_at; supervisors may only observe these.
create or replace function public.verify_presence_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' then
   if new.member_id is distinct from old.member_id or
      new.organization_id is distinct from old.organization_id or
      new.last_assigned_at is distinct from old.last_assigned_at then
      raise exception 'Presence ownership or routing timestamp cannot be changed';
   end if;
 elsif tg_op='INSERT' then
   if new.last_assigned_at is not null then
     raise exception 'Routing timestamp is reserved for the distributor';
   end if;
 end if;
 new.last_seen_at := now();
 new.updated_at := now();
 return new;
end $$;
-- RPC router executes under service_role, which is exempt from client guard.
create or replace function public.verify_presence_update()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if auth.role() = 'service_role' then return new; end if;
 if tg_op='UPDATE' then
   if new.member_id is distinct from old.member_id or
      new.organization_id is distinct from old.organization_id or
      new.last_assigned_at is distinct from old.last_assigned_at then
      raise exception 'Invalid presence update';
   end if;
 elsif new.last_assigned_at is not null then
   raise exception 'Routing timestamp is reserved for server';
 end if;
 new.last_seen_at := now();
 new.updated_at := now();
 return new;
end $$;
drop trigger if exists verify_presence_update_trigger on public.team_member_presence;
create trigger verify_presence_update_trigger before insert or update on public.team_member_presence
for each row execute function public.verify_presence_update();

-- Protect assignments against "client updates" that previously used permissive RLS.
create or replace function public.verify_conversation_assignment()
returns trigger language plpgsql security definer set search_path=public as $$
declare actor_id uuid;
declare actor_role text;
begin
 if new.assigned_member_id is not distinct from old.assigned_member_id then return new; end if;
 if new.assigned_member_id is not null and not exists (
   select 1 from public.organization_members m
   where m.id=new.assigned_member_id and m.organization_id=new.organization_id
 ) then
   raise exception 'Assigned attendant does not belong to the organization';
 end if;
 if auth.role()='service_role' then return new; end if;
 select m.id,m.role into actor_id,actor_role from public.organization_members m
 where m.organization_id=old.organization_id and m.user_id=auth.uid() limit 1;
 if actor_id is null then raise exception 'Membership required for reassignment'; end if;
 if actor_role in ('OWNER','ADMIN') then return new; end if;
 if old.assigned_member_id is null and new.assigned_member_id=actor_id then return new; end if;
 if old.assigned_member_id=actor_id then return new; end if;
 raise exception 'Only the assigned attendant or an administrator may transfer a conversation';
end $$;
drop trigger if exists verify_conversation_assignment_trigger on public.conversations;
create trigger verify_conversation_assignment_trigger before update of assigned_member_id on public.conversations
for each row execute function public.verify_conversation_assignment();

-- Atomic round-robin selection. Only the service role executing the webhook may call it.
create or replace function public.route_inbound_conversation(p_conversation_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare current_org uuid;
declare current_assignee uuid;
declare current_status text;
declare route_enabled boolean;
declare route_department uuid;
declare chosen_member uuid;
begin
 if auth.role() <> 'service_role' then raise exception 'Server-only routing'; end if;
 select c.organization_id,c.assigned_member_id,c.status
 into current_org,current_assignee,current_status
 from public.conversations c where c.id=p_conversation_id for update;
 if current_org is null or current_assignee is not null or current_status='RESOLVED' then return null; end if;
 select enabled,default_department_id into route_enabled,route_department
 from public.team_routing_settings where organization_id=current_org;
 if not coalesce(route_enabled,false) then return null; end if;

 -- Serialize concurrent distribution for the same organization/dept.
 perform pg_advisory_xact_lock(hashtext(current_org::text || coalesce(route_department::text,'')));
 select m.id into chosen_member
 from public.organization_members m
 join public.team_member_presence p on p.member_id=m.id
 where m.organization_id=current_org
   and p.organization_id=current_org
   and p.status='AVAILABLE'
   and p.last_seen_at >= now()-interval '2 minutes'
   and (route_department is null or exists (
     select 1 from public.team_department_members dm
     where dm.member_id=m.id and dm.organization_id=current_org and dm.department_id=route_department
   ))
   and not exists (
     select 1 from public.team_invitations i
     where i.organization_id=current_org and i.user_id=m.user_id and i.accepted_at is null
   )
 order by p.last_assigned_at asc nulls first,m.id
 limit 1;
 if chosen_member is null then return null; end if;
 update public.conversations set assigned_member_id=chosen_member
 where id=p_conversation_id and assigned_member_id is null;
 if not found then return null; end if;
 update public.team_member_presence
 set last_assigned_at=now()
 where member_id=chosen_member;
 return chosen_member;
end $$;
revoke all on function public.route_inbound_conversation(uuid) from public,anon,authenticated;
grant execute on function public.route_inbound_conversation(uuid) to service_role;

-- For a reliable presence switch, avoid relying on realtime to signal inactivity.
-- Enabling routing only changes assignment of FUTURE inbound messages.
