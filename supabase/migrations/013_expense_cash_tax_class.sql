-- 013: three-way cash-vs-tax classification on expenses.
--
-- Drives the two-pool financials split:
--   cashExpenses       = rows where cash_tax_class in ('both', 'cash_only')
--   deductibleExpenses = rows where cash_tax_class in ('both', 'tax_only')
--
--   'both'      cash out AND tax-deductible this year (default; software,
--               fees, hotel, the 2026-05-26 camcorder)
--   'tax_only'  deductible but no current-year cash (2025 camera gear,
--               placed in service 2026, cash left the account in 2025)
--   'cash_only' cash out but not separately deductible (actual gas while
--               the standard-mileage method is elected; empty today,
--               reserved so gas can be logged correctly later)
--
-- Additive only. Run manually in Supabase SQL Editor against prod
-- (tfpouozwmpuzwtnhrvts) before the Vercel deploy that ships the calc change.
-- Backfill of the nine 2025 equipment rows is migration-adjacent but issued
-- separately (Step 2).

alter table expenses
  add column if not exists cash_tax_class text not null default 'both';

comment on column expenses.cash_tax_class is
  'both = cash + deductible this year; tax_only = deductible, no current-year cash (prior-year gear); cash_only = cash, not separately deductible (gas under standard mileage)';

alter table expenses drop constraint if exists expenses_cash_tax_class_check;
alter table expenses add constraint expenses_cash_tax_class_check
  check (cash_tax_class in ('both', 'tax_only', 'cash_only'));
