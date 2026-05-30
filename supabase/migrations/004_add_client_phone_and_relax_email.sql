-- 004_add_client_phone_and_relax_email.sql
-- Add an optional `phone` column and relax the `email` NOT NULL constraint so
-- a client can be created with a phone number instead of an email.
--
-- Backfill: early "draft" clients were created with a fake
-- "name@<10-digit-number>.com" email purely to satisfy the old NOT NULL
-- constraint — they were never real addresses. Extract the digits into
-- `phone` and null the email out.
--
-- Phone canonical format: a bare 10-digit string (no punctuation, no country
-- code, e.g. 5125551234). The Add Client form + actions normalize to this
-- shape (see normalizePhone in app/owner/clients/_actions.ts) and it is
-- rendered as (XXX) XXX-XXXX by formatPhone in
-- app/owner/clients/_lib/format.ts.
--
-- The "at least one contact method" rule (email OR phone) is enforced at the
-- application layer (the Add Client action + the clients PATCH route), NOT as
-- a DB CHECK, so existing rows with NULL email and NULL phone (none today, but
-- possible in archived edge cases) don't break this migration or future writes.
--
-- Note: the pre-existing UNIQUE constraint on email survives the DROP NOT NULL.
-- Postgres allows multiple NULLs in a unique index, so phone-only rows coexist.

alter table clients add column if not exists phone text;
alter table clients alter column email drop not null;

-- Backfill the fake "name@##########.com" rows: pull the 10 digits out of the
-- email host into phone, then null the email. Idempotent — after the first run
-- no rows match the pattern, so re-running is a safe no-op.
update clients
set
  phone = regexp_replace(
    split_part(split_part(email, '@', 2), '.', 1),
    '[^0-9]', '', 'g'
  ),
  email = null
where email ~* '^[a-z]+@[0-9]{10}\.com$';
