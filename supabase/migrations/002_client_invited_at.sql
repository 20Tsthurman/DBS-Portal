-- 002_client_invited_at.sql
-- Decouples client creation from invitation.
-- invited_at IS NULL  = draft client (created, never invited, no portal access)
-- invited_at IS NOT NULL = invite has been sent
alter table clients add column if not exists invited_at timestamptz;

-- Backfill: every client created under the old flow was invited at creation time,
-- so existing rows are NOT drafts. Safe one-time backfill.
update clients set invited_at = created_at where invited_at is null;
