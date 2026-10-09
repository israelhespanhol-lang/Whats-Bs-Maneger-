create or replace function public.refresh_broadcast_counters(p_broadcast_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent integer := 0;
  v_delivered integer := 0;
  v_read integer := 0;
  v_failed integer := 0;
  v_pending integer := 0;
begin
  select
    count(*) filter (where status in ('SENT','DELIVERED','READ')),
    count(*) filter (where status in ('DELIVERED','READ')),
    count(*) filter (where status = 'READ'),
    count(*) filter (where status = 'FAILED'),
    count(*) filter (where status = 'PENDING')
  into v_sent, v_delivered, v_read, v_failed, v_pending
  from public.broadcast_recipients
  where broadcast_id = p_broadcast_id;

  update public.broadcasts
  set
    sent_count = coalesce(v_sent, 0),
    delivered_count = coalesce(v_delivered, 0),
    read_count = coalesce(v_read, 0),
    failed_count = coalesce(v_failed, 0),
    status = case
      when status = 'CANCELED' then status
      when coalesce(v_pending, 0) = 0 then 'COMPLETED'
      when status in ('READY','DRAFT') then 'SENDING'
      else status
    end,
    completed_at = case
      when coalesce(v_pending, 0) = 0 and status <> 'CANCELED'
        then coalesce(completed_at, now())
      else completed_at
    end,
    updated_at = now()
  where id = p_broadcast_id;
end;
$$;

revoke all on function public.refresh_broadcast_counters(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_broadcast_counters(uuid)
  to service_role;

alter table public.broadcast_recipients
  drop constraint if exists broadcast_recipients_status_check;

alter table public.broadcast_recipients
  add constraint broadcast_recipients_status_check
  check (
    status in (
      'PENDING','PROCESSING','SENT','DELIVERED','READ','FAILED','SKIPPED'
    )
  );

create or replace function public.claim_broadcast_recipients(
  p_broadcast_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  contact_id uuid,
  phone_e164 text
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
    returning br.id, br.contact_id, br.phone_e164
  )
  select claimed.id, claimed.contact_id, claimed.phone_e164
  from claimed;
end;
$$;

revoke all on function public.claim_broadcast_recipients(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_broadcast_recipients(uuid, integer)
  to service_role;

create or replace function public.release_stale_broadcast_recipients(
  p_broadcast_id uuid,
  p_older_than interval default interval '10 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.broadcast_recipients
  set
    status = 'PENDING',
    updated_at = now()
  where broadcast_id = p_broadcast_id
    and status = 'PROCESSING'
    and updated_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.release_stale_broadcast_recipients(uuid, interval)
  from public, anon, authenticated;
grant execute on function public.release_stale_broadcast_recipients(uuid, interval)
  to service_role;
