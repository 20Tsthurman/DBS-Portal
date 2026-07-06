-- 012_shoots_google_push.sql
-- Stage 3: portal → Google push. Portal-created shoots become real events
-- on Kelsey's "digital bloom" Google calendar (fallback: primary).
--
-- PURELY ADDITIVE and idempotent. No DROP, no destructive ALTER, no data
-- writes.

-- ----------------------------------------------------------------------------
-- shoots.google_event_id / google_calendar_id — where this shoot lives in
-- Google after a push (both NULL = never pushed). calendar_id is stored per
-- shoot so a later change of push target can't strand patch/delete calls.
-- google_sync_pending — the retry flag: set when a push fails (Google down,
-- token expired, write scope not yet granted); swept by
-- retryPendingGooglePushes() on every sync (cron + sync-on-view).
-- ----------------------------------------------------------------------------
alter table shoots add column if not exists google_event_id text;
alter table shoots add column if not exists google_calendar_id text;
alter table shoots add column if not exists google_sync_pending boolean not null default false;

create unique index if not exists shoots_google_event_id_uidx
  on shoots (google_event_id) where google_event_id is not null;

-- ----------------------------------------------------------------------------
-- google_calendar_connection:
--   granted_scopes — space-separated OAuth scopes from the token response.
--     NULL (pre-Stage-3 grants) or missing the write scope → the portal
--     treats the connection as read-only and settings shows a "reconnect to
--     enable pushing" prompt. Exact-token matching in code, not substring.
--   push_calendar_id / push_calendar_summary — the resolved push target,
--     cached after the first push ("digital bloom" by summary match, else
--     primary). Cleared on reconnect and re-resolved.
-- ----------------------------------------------------------------------------
alter table google_calendar_connection add column if not exists granted_scopes text;
alter table google_calendar_connection add column if not exists push_calendar_id text;
alter table google_calendar_connection add column if not exists push_calendar_summary text;
