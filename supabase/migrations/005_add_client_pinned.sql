-- 005_add_client_pinned.sql
-- Add a per-client `pinned` flag so the owner can keep priority clients at the
-- top of the /owner/clients roster. Sorting is applied client-side in
-- ClientsTable (pinned DESC, then created_at DESC); fetchClientsWithRelations'
-- ORDER BY is intentionally left untouched so the dashboard widgets that share
-- that query are unaffected.
alter table clients add column pinned boolean not null default false;
