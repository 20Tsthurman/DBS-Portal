-- ============================================================================
-- Phase 4 Invoices — schema alignment.
--
-- Adds the human-readable invoice number column on `invoices`, the linkage
-- from `income_payments` back to its originating invoice, and extends the
-- payment-source enum with an `invoice` value (alongside `manual` and
-- `suggested_retainer` introduced in 001_phase4_suggestions.sql).
--
-- Pre-flight: the `invoices` table is empty in every environment (no
-- application code path has ever read or written it prior to this
-- migration — see docs/audits/phase-4-invoices-audit.md §1-§2). The
-- `invoice_number` column is therefore added as nullable with no backfill;
-- new rows assign the number under transaction in the create action.
-- Uniqueness is enforced by a partial index that ignores NULL.
--
-- Apply once via the Supabase SQL editor after schema.sql and prior
-- migrations are up to date.
-- ============================================================================

alter table invoices add column if not exists invoice_number text;

-- Per-year sequence. Format: INV-YYYY-NNNN (zero-padded to 4 digits).
-- Uniqueness is enforced by this partial index, not by a DB sequence —
-- the action layer assigns the number and retries once on collision.
create unique index if not exists invoices_invoice_number_idx
  on invoices (invoice_number)
  where invoice_number is not null;

-- ---------------------------------------------------------------------------
-- income_payments.invoice_id
--
-- Links an income row back to the invoice that produced it. NULL = manual
-- income entry that has no associated invoice (existing rows plus any
-- non-invoice income going forward). On invoice delete, set null rather
-- than cascading — the income row is its own historical record once
-- recorded.
-- ---------------------------------------------------------------------------
alter table income_payments
  add column if not exists invoice_id uuid
    references invoices(id) on delete set null;

create index if not exists income_payments_invoice_id_idx
  on income_payments (invoice_id);

-- ---------------------------------------------------------------------------
-- Extend the `source` enum to include 'invoice'.
--
-- The CHECK constraint added in 001_phase4_suggestions.sql allowed only
-- 'manual' and 'suggested_retainer'. Drop and re-add with the new value.
-- ---------------------------------------------------------------------------
alter table income_payments drop constraint if exists income_payments_source_check;
alter table income_payments
  add constraint income_payments_source_check
  check (source is null or source in ('manual', 'suggested_retainer', 'invoice'));

alter table invoices add column if not exists income_type text
  check (income_type in ('brand_retainer', 'wedding_same_day', 'one_off_shoot', 'other'))
  default 'other'
  not null;

-- ---------------------------------------------------------------------------
-- invoices.memo
--
-- Free-form note shown on the generated PDF and the payment email. Optional;
-- empty = no memo block. Plain text — rendered as-is, no HTML support.
-- ---------------------------------------------------------------------------
alter table invoices add column if not exists memo text;

-- ---------------------------------------------------------------------------
-- invoices.sent_at
--
-- Timestamp when the invoice transitioned from draft -> sent. NULL while in
-- draft. The "issued date" rendered on the PDF and shown in lists is derived
-- from this column (date portion), not from `created_at`. `created_at`
-- remains for audit/row-creation purposes.
-- ---------------------------------------------------------------------------
alter table invoices add column if not exists sent_at timestamptz;