-- ============================================================================
-- Phase 4 Financials — Smart-Layer Suggestions
--
-- Adds the dismissed_suggestions table and three nullable origin columns on
-- the destination tables (income_payments.source, mileage_logs.source_shoot_id,
-- expenses.source_template_id). All operations are idempotent and safe to
-- re-run; existing rows are implicitly treated as `source = 'manual'`.
--
-- Apply once via the Supabase SQL editor after schema.sql is up to date.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- dismissed_suggestions
--
-- Tracks per-month dismissals of auto-generated suggestions so the financials
-- page doesn't re-surface them. One row per (suggestion type, source record,
-- month). The unique constraint enforces idempotency on the dismiss action.
--
-- type meanings:
--   income_retainer  — brand-retainer income suggestion for client `reference_id`
--   mileage_shoot    — mileage suggestion for shoot `reference_id`
--   expense_template — recurring-expense suggestion for template `reference_id`
--
-- period_yyyymm is a wall-clock month key in PORTAL_TIMEZONE (e.g. '2026-05'),
-- matching the format produced by currentMonthKey() in
-- app/owner/calendar/_lib/timezone.ts.
-- ---------------------------------------------------------------------------
create table if not exists dismissed_suggestions (
  id             uuid primary key default gen_random_uuid(),
  type           text not null check (type in (
                   'income_retainer',
                   'mileage_shoot',
                   'expense_template'
                 )),
  reference_id   uuid not null,
  period_yyyymm  text not null check (period_yyyymm ~ '^\d{4}-\d{2}$'),
  dismissed_at   timestamptz not null default now(),
  constraint dismissed_suggestions_unique
    unique (type, reference_id, period_yyyymm)
);

-- Page load fetches "all dismissals for the current month" once and checks
-- each suggestion against the set in memory. The unique index above is on
-- (type, reference_id, period_yyyymm) — leading with period_yyyymm here so
-- the page-load query hits a single column.
create index if not exists dismissed_suggestions_period_idx
  on dismissed_suggestions (period_yyyymm);

-- ---------------------------------------------------------------------------
-- Origin / source columns on the three destination tables.
--
-- All three columns are nullable. Existing rows get NULL on first run; the
-- application treats NULL as equivalent to "manual entry" (no migration
-- backfill needed). Future suggestion-accept actions write the appropriate
-- non-NULL value so suppression checks can use the FK / enum directly
-- instead of falling back to fuzzy date+name matching.
-- ---------------------------------------------------------------------------

alter table income_payments
  add column if not exists source text
    check (source is null or source in ('manual', 'suggested_retainer'));

alter table mileage_logs
  add column if not exists source_shoot_id uuid
    references shoots(id) on delete set null;

alter table expenses
  add column if not exists source_template_id uuid
    references recurring_expense_templates(id) on delete set null;

-- Partial indexes for the suppression lookups Phase 4 runs on every
-- /owner/financials render. The expression `where … is not null` keeps the
-- indexes small on tables where the vast majority of rows are manual.
create index if not exists mileage_logs_source_shoot_id_idx
  on mileage_logs (source_shoot_id) where source_shoot_id is not null;

create index if not exists expenses_source_template_id_idx
  on expenses (source_template_id) where source_template_id is not null;
