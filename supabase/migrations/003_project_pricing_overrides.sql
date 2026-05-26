-- 003_project_pricing_overrides.sql
-- Per-client overrides for grandfathered/discounted clients.
-- NULL = inherit the package default. A value overrides it for THIS client only.
alter table projects add column if not exists monthly_price_override numeric;
alter table projects add column if not exists monthly_hours_override numeric;
alter table projects drop constraint if exists projects_price_override_nonneg;
alter table projects add constraint projects_price_override_nonneg
  check (monthly_price_override is null or monthly_price_override >= 0);
alter table projects drop constraint if exists projects_hours_override_nonneg;
alter table projects add constraint projects_hours_override_nonneg
  check (monthly_hours_override is null or monthly_hours_override >= 0);
