create or replace function public.guard_meta_test_template()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.name = 'hello_world' then
    new.status := 'ARCHIVED';
    new.meta_status_reason :=
      'Template padrão de teste da Meta; não utilizável com o número de produção.';
  end if;

  return new;
end;
$$;

drop trigger if exists message_templates_guard_meta_test on public.message_templates;
create trigger message_templates_guard_meta_test
before insert or update on public.message_templates
for each row execute function public.guard_meta_test_template();
