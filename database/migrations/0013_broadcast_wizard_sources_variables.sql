alter table public.broadcasts
  add column if not exists whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null,
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null,
  add column if not exists source_type text not null default 'CRM_STATUS',
  add column if not exists source_meta jsonb not null default '{}'::jsonb,
  add column if not exists excluded_count integer not null default 0,
  add column if not exists scheduled_at timestamptz;

alter table public.broadcast_recipients
  alter column contact_id drop not null;

alter table public.broadcast_recipients
  add column if not exists recipient_name text,
  add column if not exists variables jsonb not null default '{}'::jsonb,
  add column if not exists source_row integer,
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists exclude_reason text;

create index if not exists broadcasts_account_idx
  on public.broadcasts (whatsapp_account_id);
create index if not exists broadcasts_campaign_idx
  on public.broadcasts (campaign_id);
create index if not exists broadcast_recipients_message_idx
  on public.broadcast_recipients (whatsapp_message_id)
  where whatsapp_message_id is not null;

drop function if exists public.claim_broadcast_recipients(uuid, integer);

create function public.claim_broadcast_recipients(
  p_broadcast_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  contact_id uuid,
  phone_e164 text,
  recipient_name text,
  variables jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select br.id
    from public.broadcast_recipients br
    where br.broadcast_id = p_broadcast_id
      and br.status = 'PENDING'
    order by br.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ),
  claimed as (
    update public.broadcast_recipients br
    set
      status = 'PROCESSING',
      updated_at = now()
    from picked
    where br.id = picked.id
    returning
      br.id,
      br.contact_id,
      br.phone_e164,
      br.recipient_name,
      br.variables
  )
  select
    claimed.id,
    claimed.contact_id,
    claimed.phone_e164,
    claimed.recipient_name,
    claimed.variables
  from claimed;
end;
$$;

revoke all on function public.claim_broadcast_recipients(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_broadcast_recipients(uuid, integer)
  to service_role;
