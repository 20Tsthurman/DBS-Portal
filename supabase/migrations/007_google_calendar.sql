-- 007_google_calendar.sql
-- Google Calendar sync, Stage 1: Google → Portal read-only import.
--
-- PURELY ADDITIVE: two new tables (google_calendar_connection,
-- external_events). No DROP, no destructive ALTER, no data writes. Safe to
-- run top-to-bottom in the Supabase SQL Editor.
--
-- Conventions match 001_initial_schema.sql: text + CHECK (no PG enums),
-- singleton via UNIQUE(singleton), RLS enabled with NO policies
-- (service-role-only), idempotent guards throughout.

-- ----------------------------------------------------------------------------
-- google_calendar_connection — the single OAuth grant for Kelsey's personal
-- Gmail (0 or 1 row). refresh_token is the long-lived credential; the app
-- exchanges it for short-lived access tokens (access_token / token_expiry are
-- a cache of the most recent one). calendar_id stays 'primary' for now but is
-- a column so a different calendar can be targeted without a migration.
--
-- sync_token drives incremental sync (Google events.list nextSyncToken).
-- NULL = next sync is a full-window fetch.
--
-- watch_* are reserved for Stage 3 push notifications (events.watch
-- channels); nullable and unused in Stage 1.
-- ----------------------------------------------------------------------------
create table if not exists google_calendar_connection (
  id                uuid primary key default gen_random_uuid(),
  singleton         boolean not null default true,
  refresh_token     text not null,
  access_token      text,
  token_expiry      timestamptz,
  calendar_id       text not null default 'primary',
  sync_token        text,
  watch_channel_id  text,
  watch_resource_id text,
  watch_expiration  timestamptz,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint google_calendar_connection_singleton_unique unique (singleton)
);

-- ----------------------------------------------------------------------------
-- external_events — mirror of Google Calendar events inside the sync window.
-- google_event_id is Google's event id (unique per instance once expanded
-- with singleEvents=true), and is the upsert key. Cancelled events are kept
-- as tombstones (status='cancelled') rather than deleted, so an incremental
-- sync can flip them back if the event is restored.
--
-- All-day events store PORTAL_TIMEZONE midnights in starts_at/ends_at
-- (ends_at exclusive, matching Google's exclusive end.date) with
-- all_day=true.
-- ----------------------------------------------------------------------------
create table if not exists external_events (
  id               uuid primary key default gen_random_uuid(),
  google_event_id  text not null unique,
  title            text,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  all_day          boolean not null default false,
  status           text not null default 'confirmed',
  html_link        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table external_events drop constraint if exists external_events_status_check;
alter table external_events add constraint external_events_status_check
  check (status in ('confirmed', 'cancelled'));

-- Range scans: fetchEventsInRange and checkBookingConflicts both filter on
-- starts_at overlap windows.
create index if not exists external_events_starts_at_idx
  on external_events (starts_at);

-- ----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY — enabled, NO policies (service-role-only, fail-closed),
-- matching every other table. Especially load-bearing here: the connection
-- row holds an OAuth refresh token.
-- ----------------------------------------------------------------------------
alter table google_calendar_connection enable row level security;
alter table external_events            enable row level security;
