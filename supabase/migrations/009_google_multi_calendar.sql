-- 009_google_multi_calendar.sql
-- Google Calendar sync: import from MULTIPLE selected calendars, not just
-- the account's primary one.
--
-- ADDITIVE with one deliberate exception, and one guarded data backfill:
--   * New table google_synced_calendars (one row per calendar Kelsey has
--     chosen to import). Google sync tokens are PER-CALENDAR, so each row
--     carries its own sync_token / last_synced_at.
--   * external_events gains calendar_id. Google event ids repeat across
--     calendars, so the old UNIQUE(google_event_id) is replaced by a unique
--     index on (calendar_id, google_event_id) — the only non-additive
--     statement here, and it only WIDENS what the table accepts.
--   * Backfill INSERT (bottom): deviates from the usual no-data-writes rule
--     so the already-deployed primary-calendar sync continues seamlessly —
--     it carries the live sync_token over, is guarded by WHERE NOT EXISTS,
--     and is a no-op on re-run or on a fresh database.
--
-- google_calendar_connection.calendar_id and .sync_token are DEAD after
-- this migration (left in place per the additive-only rule); the app reads
-- per-calendar state from google_synced_calendars instead.
--
-- Calendar-id convention: the primary calendar is stored under the alias
-- 'primary' (which the Google API accepts anywhere a calendarId goes), NOT
-- its real email-shaped id. This keeps continuity with the deployed rows
-- and the column default below.

-- ----------------------------------------------------------------------------
-- google_synced_calendars — the calendars selected for import (0..N rows).
-- summary/color are display snapshots for the settings checkboxes, refreshed
-- from calendarList.list whenever the settings page can reach Google.
-- sync_token NULL = next sync does a full-window fetch for that calendar.
-- ----------------------------------------------------------------------------
create table if not exists google_synced_calendars (
  id              uuid primary key default gen_random_uuid(),
  calendar_id     text not null unique,
  summary         text,
  color           text,
  sync_token      text,
  last_synced_at  timestamptz,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- external_events.calendar_id — which calendar each imported event came from.
-- Default 'primary' doubles as the backfill for rows imported before this
-- migration (all of which came from the primary calendar).
-- ----------------------------------------------------------------------------
alter table external_events add column if not exists calendar_id text not null default 'primary';

-- Uniqueness scoped per calendar. The old constraint was declared inline in
-- 007 (`google_event_id text not null unique`), so it carries the
-- auto-generated name external_events_google_event_id_key.
alter table external_events drop constraint if exists external_events_google_event_id_key;
create unique index if not exists external_events_calendar_event_uidx
  on external_events (calendar_id, google_event_id);

-- ----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY — enabled, NO policies (service-role-only, fail-closed),
-- matching every other table.
-- ----------------------------------------------------------------------------
alter table google_synced_calendars enable row level security;

-- ----------------------------------------------------------------------------
-- Continuity backfill — see header. Seeds the primary calendar as selected
-- for the existing connection, carrying its incremental token so the next
-- sync doesn't re-fetch the whole window. Idempotent.
-- ----------------------------------------------------------------------------
insert into google_synced_calendars (calendar_id, summary, sync_token, last_synced_at)
select 'primary', 'Primary calendar', sync_token, last_synced_at
from google_calendar_connection
where not exists (select 1 from google_synced_calendars);
