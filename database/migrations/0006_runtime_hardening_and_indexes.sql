create index if not exists campaigns_created_by_idx
  on public.campaigns (created_by);

create index if not exists campaigns_template_id_idx
  on public.campaigns (template_id);

create index if not exists message_templates_created_by_idx
  on public.message_templates (created_by);

create or replace function public.touch_conversation_inbound(
  p_conversation_id uuid,
  p_received_at timestamptz,
  p_window_expires_at timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversations
  set
    status = 'OPEN',
    unread_count = unread_count + 1,
    last_message_at = p_received_at,
    customer_service_window_expires_at = p_window_expires_at,
    updated_at = now()
  where id = p_conversation_id;
$$;

revoke all on function public.touch_conversation_inbound(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.touch_conversation_inbound(uuid, timestamptz, timestamptz)
  to service_role;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;
