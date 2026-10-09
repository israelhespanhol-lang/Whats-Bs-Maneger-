alter table public.message_templates
  add column if not exists header_type text not null default 'NONE',
  add column if not exists header_text text,
  add column if not exists header_example text,
  add column if not exists footer_text text,
  add column if not exists buttons jsonb not null default '[]'::jsonb,
  add column if not exists body_examples jsonb not null default '[]'::jsonb,
  add column if not exists meta_template_id text,
  add column if not exists meta_status_reason text,
  add column if not exists submitted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'message_templates_header_type_check'
  ) then
    alter table public.message_templates
      add constraint message_templates_header_type_check
      check (header_type in ('NONE','TEXT'));
  end if;
end
$$;

create index if not exists message_templates_meta_name_idx
  on public.message_templates (organization_id, meta_template_name);

create index if not exists message_templates_meta_id_idx
  on public.message_templates (meta_template_id)
  where meta_template_id is not null;
