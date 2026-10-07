alter table users alter column id drop default;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_auth_user_fkey'
  ) then
    alter table users
      add constraint users_auth_user_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end
$$;

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into users (id, email, name)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@local.invalid'),
    coalesce(
      nullif(new.raw_user_meta_data->>'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuário'
    )
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = excluded.name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function handle_new_auth_user();

create or replace function is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members om
    where om.organization_id = target_org
      and om.user_id = auth.uid()
  );
$$;

create or replace function is_org_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members om
    where om.organization_id = target_org
      and om.user_id = auth.uid()
      and om.role in ('OWNER', 'ADMIN')
  );
$$;

create policy organizations_select_member
  on organizations for select to authenticated
  using (is_org_member(id));

create policy users_select_self
  on users for select to authenticated
  using (id = auth.uid());

create policy users_update_self
  on users for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy members_select
  on organization_members for select to authenticated
  using (user_id = auth.uid() or is_org_admin(organization_id));

create policy members_admin_all
  on organization_members for all to authenticated
  using (is_org_admin(organization_id))
  with check (is_org_admin(organization_id));

create policy whatsapp_accounts_member_all
  on whatsapp_accounts for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy contacts_member_all
  on contacts for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy tags_member_all
  on tags for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy conversations_member_all
  on conversations for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy messages_member_all
  on messages for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

create policy audit_logs_member_select
  on audit_logs for select to authenticated
  using (is_org_member(organization_id));

create policy audit_logs_member_insert
  on audit_logs for insert to authenticated
  with check (is_org_member(organization_id));

create policy contact_tags_member_all
  on contact_tags for all to authenticated
  using (
    exists (
      select 1
      from contacts c
      where c.id = contact_id
        and is_org_member(c.organization_id)
    )
  )
  with check (
    exists (
      select 1
      from contacts c
      where c.id = contact_id
        and is_org_member(c.organization_id)
    )
  );