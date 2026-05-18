-- ============================================================================
-- Phase 5 Files Delivery — schema alignment.
--
-- Brings the `files` table in line with the signed-upload + signed-download
-- flow. The pre-Phase-5 column `file_url` was always intended to hold the
-- canonical storage key (the `name` column carries the human-readable
-- filename), so it's renamed to `storage_path`. `mime_type` and `size_bytes`
-- are persisted from verified storage-object metadata at finalize time so
-- the list view can render type pills and human-readable sizes without a
-- second round-trip to Storage.
--
-- Pre-flight: the `files` table is empty in every environment (no
-- application code path has ever inserted into it — see
-- docs/audits/phase-5-files-audit.md §3 and the absence of any callsite
-- writing the table prior to this migration). The defensive backfill
-- below (`update … where … is null`) covers the unlikely case of an
-- in-flight row landing between this migration's first statement and the
-- NOT NULL alter.
--
-- Apply once via the Supabase SQL editor after schema.sql is up to date.
-- ============================================================================

alter table files rename column file_url to storage_path;

alter table files add column if not exists mime_type text;
alter table files add column if not exists size_bytes bigint;

-- Defensive: any pre-existing row (none expected) gets safe defaults so
-- the NOT NULL alter below cannot fail mid-deploy.
update files set mime_type = '' where mime_type is null;
update files set size_bytes = 0 where size_bytes is null;

alter table files alter column mime_type set not null;
alter table files alter column size_bytes set not null;
