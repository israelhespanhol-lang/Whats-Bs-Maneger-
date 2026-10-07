create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create index if not exists organization_members_user_id_idx
  on organization_members (user_id);

create index if not exists conversations_whatsapp_account_id_idx
  on conversations (whatsapp_account_id);

create index if not exists conversations_contact_id_idx
  on conversations (contact_id);

create index if not exists conversations_assigned_member_id_idx
  on conversations (assigned_member_id);

create index if not exists messages_reply_to_message_id_idx
  on messages (reply_to_message_id);

create index if not exists contact_tags_tag_id_idx
  on contact_tags (tag_id);

create index if not exists audit_logs_organization_id_idx
  on audit_logs (organization_id);

create index if not exists audit_logs_actor_user_id_idx
  on audit_logs (actor_user_id);
