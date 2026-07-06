-- 010_shoot_candidates.sql
-- Stage 2 (lean): "Shoot/Content" capture flow. Google events whose title
-- matches shoot|content become pending candidates in a Confirm Shoots queue;
-- on confirm they become real shoots rows via the existing createShoot path.
--
-- ADDITIVE columns on external_events plus one deliberate data write (the
-- sync-token reset at the bottom — same tradeoff as 009's backfill).
-- Idempotent throughout; text + CHECK per repo convention.

-- ----------------------------------------------------------------------------
-- external_events.location — the Google event's location text. The lean
-- capture flow passes this straight into shoots.location on confirm (no
-- geocoding); mileage then flows from the shoot via the existing
-- Distance Matrix suggestion path.
-- ----------------------------------------------------------------------------
alter table external_events add column if not exists location text;

-- ----------------------------------------------------------------------------
-- external_events.shoot_candidate — candidate lifecycle.
--   NULL        = plain imported event (title never matched, or unmatched now)
--   'pending'   = in the Confirm Shoots queue
--   'dismissed' = Kelsey said not-a-shoot; plain busy event again, never re-prompts
--   'confirmed' = converted; converted_shoot_id points at the created shoot
-- Sync only ever sets 'pending' on rows where this is NULL, so confirm/
-- dismiss decisions survive every re-sync.
-- ----------------------------------------------------------------------------
alter table external_events add column if not exists shoot_candidate text;

alter table external_events drop constraint if exists external_events_shoot_candidate_check;
alter table external_events add constraint external_events_shoot_candidate_check
  check (shoot_candidate is null or shoot_candidate in ('pending', 'confirmed', 'dismissed'));

-- ----------------------------------------------------------------------------
-- external_events.converted_shoot_id — set on confirm. Rows with a non-NULL
-- value are excluded from calendar rendering and booking conflicts (the
-- shoot row does both jobs). ON DELETE SET NULL: deleting the shoot makes
-- the Google event resurface as a normal busy event — no hole, no double.
-- ----------------------------------------------------------------------------
alter table external_events add column if not exists converted_shoot_id
  uuid references shoots(id) on delete set null;

create index if not exists external_events_shoot_candidate_idx
  on external_events (shoot_candidate) where shoot_candidate is not null;

-- ----------------------------------------------------------------------------
-- One-time forced full re-fetch: incremental sync only re-sends events that
-- CHANGED in Google, so already-imported rows would never pick up `location`.
-- Clearing the per-calendar tokens makes the next sync re-fetch the full
-- window (upserts are idempotent — re-running this just forces another full
-- sync, nothing is lost).
-- ----------------------------------------------------------------------------
update google_synced_calendars set sync_token = null;
