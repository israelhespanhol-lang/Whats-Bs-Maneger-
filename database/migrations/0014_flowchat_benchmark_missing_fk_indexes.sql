create index if not exists crm_funnels_created_by_idx
  on public.crm_funnels (created_by);

create index if not exists crm_stages_organization_id_idx
  on public.crm_stages (organization_id);

create index if not exists whatsapp_pricing_rates_updated_by_idx
  on public.whatsapp_pricing_rates (updated_by);
