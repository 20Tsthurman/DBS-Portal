-- 014: soft-retire an invoice ("Inactive") instead of deleting it.
--
-- Before this, the only way to remove an invoice was `deleteInvoiceAction`,
-- which is restricted to drafts and destroys the row (and its number). A sent
-- or overdue invoice that was cancelled, superseded, or billed by mistake had
-- nowhere to go — it sat in the Open list forever.
--
-- `inactive_at` is the marker. NULL = live invoice. Non-NULL = retired at that
-- moment: the row, its number, its line items, and its PDF all stay put, but
-- it drops out of the owner's default lists, disappears from the client
-- portal, and can no longer be sent / edited / paid. Clearing the column
-- reactivates it, which is why the underlying `status` is left untouched —
-- a reactivated invoice returns to exactly the state it was retired from.
--
-- No status-enum change: 'inactive' is a *derived* status (like 'overdue'),
-- computed at read time in _lib/queries.ts. Paid invoices are never
-- retireable — the money is recorded in income_payments.
--
-- Additive only. Run manually in the Supabase SQL Editor against prod before
-- the Vercel deploy that ships the UI.

alter table invoices add column if not exists inactive_at timestamptz;

comment on column invoices.inactive_at is
  'NULL = live invoice. Non-NULL = soft-retired ("Inactive") at this timestamp: hidden from default owner lists and from the client portal, not sendable/editable/payable, but kept for history. Clear to reactivate.';

-- Every default list query filters `inactive_at is null`; the partial index
-- keeps that the cheap path as the table grows.
create index if not exists invoices_inactive_at_idx
  on invoices (inactive_at)
  where inactive_at is not null;
