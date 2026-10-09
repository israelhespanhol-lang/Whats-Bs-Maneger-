alter table public.whatsapp_pricing_rates
  add column if not exists market text not null default 'BR',
  add column if not exists currency text not null default 'BRL',
  add column if not exists tier_list jsonb not null default '[]'::jsonb,
  add column if not exists source text not null default 'META_OFFICIAL',
  add column if not exists source_url text,
  add column if not exists fetched_at timestamptz;

create index if not exists whatsapp_pricing_rates_org_market_currency_idx
  on public.whatsapp_pricing_rates (organization_id, market, currency);
