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
  v_remaining integer := 0;
begin
  select
    count(*) filter (where status in ('SENT','DELIVERED','READ')),
    count(*) filter (where status in ('DELIVERED','READ')),
    count(*) filter (where status = 'READ'),
    count(*) filter (where status = 'FAILED'),
    count(*) filter (where status in ('PENDING','PROCESSING'))
  into v_sent, v_delivered, v_read, v_failed, v_remaining
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
      when coalesce(v_remaining, 0) = 0 then 'COMPLETED'
      when status in ('READY','DRAFT') then 'SENDING'
      else status
    end,
    completed_at = case
      when coalesce(v_remaining, 0) = 0 and status <> 'CANCELED'
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
