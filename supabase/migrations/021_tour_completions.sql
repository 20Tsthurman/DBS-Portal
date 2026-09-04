-- 021_tour_completions.sql
-- Guided Tours, Stage 1: schema only. Backs the client onboarding tour
-- (Tour 1) and, unchanged, the content approval tour (Tour 2) that follows.
--
-- PURELY ADDITIVE: one new table with four CHECK constraints and one UNIQUE.
-- No existing table or column is modified, no DROP, no destructive ALTER, no
-- data writes. Safe to run top-to-bottom in the Supabase SQL Editor, and safe
-- to re-run.
--
-- Conventions match 001 and 015-020: text + CHECK (no PG enums), no triggers
-- and no functions, UNIQUE inline in the create, CHECKs as separate named
-- constraints applied with DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT, RLS
-- enabled with NO policies (service-role-only), idempotent guards throughout.
--
-- NO PRE-FLIGHT BLOCK. 018 and 019 carry one because each adds a CHECK to a
-- table that already holds rows, and a hand-set row could half-apply the
-- file. This file creates its table, so there are no existing rows for any
-- constraint to fail against. There is nothing to look at first.
--
-- NOTHING IN THIS MIGRATION IS READ BY THE APP YET. It ships ahead of the
-- tour UI; an empty table is the correct steady state until the gate and the
-- completion action land. An empty table means every client is un-toured,
-- which is exactly right.

-- ----------------------------------------------------------------------------
-- tour_completions — one row per (person, tour, version). The row's existence
-- IS the completion; there is no boolean to flip and nothing is ever updated.
--
-- WHY A TABLE, not localStorage and not Clerk publicMetadata. Kelsey needs to
-- answer "who have I actually onboarded?" — a question localStorage cannot be
-- asked (it is per-browser, and a client who switches from their laptop to
-- their phone would see Tour 1 twice) and Clerk metadata can only be asked one
-- user at a time over the network. This is a queryable fact about a client
-- relationship, so it lives in Postgres with the rest of them.
--
-- WHY clerk_user_id AND NOT clients.id. Owner-side tours will reuse this
-- table, and Kelsey has no clients row — keying on clients.id would make her
-- tour state unrepresentable. The Clerk user id is the one identifier both
-- roles carry.
--
-- THERE IS DELIBERATELY NO FOREIGN KEY. clients.clerk_user_id is `text unique`
-- but NULLABLE (001), so it cannot be the target of a FK from a NOT NULL
-- column, and Kelsey has no row to point at in any case. Two consequences,
-- both accepted rather than overlooked:
--
--   1. The user.deleted webhook (app/api/webhooks/clerk/route.ts) nulls
--      clients.clerk_user_id; it does not reach this table. Rows for a deleted
--      Clerk user are orphaned — a few dozen bytes of dead history on a table
--      that gains at most two rows per person for the life of the portal. A
--      cascade would be worse: it would silently erase Kelsey's record that a
--      client WAS onboarded, which is the whole reason this table exists.
--   2. A client re-invited under a fresh Clerk user starts over, and Tour 1
--      fires again. That is the correct outcome for what is, to Clerk, a new
--      person.
--
-- NOT NULL and non-empty, mirroring 001's clerk_user_id_not_empty guard on
-- clients: an empty string would satisfy NOT NULL, break the UNIQUE the gate
-- depends on, and silently re-fire the tour on every visit.
--
-- version — which BUILD of the tour was completed, carried in the UNIQUE so a
-- reworked tour re-fires without deleting anyone's history. Bumping the
-- constant in the app makes every existing row miss the gate's equality test;
-- last year's completion stays on the table as the record it is. An int, not
-- a semver string: it is a counter, and nothing ever sorts or ranges over it.
--
-- ended_at — when the tour ended, whichever way it ended. Deliberately NOT
-- named completed_at: an outcome = 'skipped' row is not a completion, and a
-- timestamp named for one of the two outcomes misreads on the other half of
-- the table. This is the date Kelsey's roster shows ("onboarded Sept 4" for a
-- completed row, and the dismissal date for a skipped one). Defaulted rather
-- than passed by the app, matching every other created_at in the schema.
-- ----------------------------------------------------------------------------
create table if not exists tour_completions (
  id             uuid primary key default gen_random_uuid(),
  clerk_user_id  text not null,
  tour_key       text not null,
  version        int  not null,
  outcome        text not null,
  ended_at       timestamptz not null default now(),
  constraint tour_completions_user_tour_version_unique
    unique (clerk_user_id, tour_key, version)
);

alter table tour_completions drop constraint if exists tour_completions_clerk_user_id_not_empty;
alter table tour_completions add constraint tour_completions_clerk_user_id_not_empty
  check (length(clerk_user_id) > 0);

-- Which tour. Text + CHECK, not an enum, per house convention — Tour 2 is
-- already named here so it needs no schema change at all, and a third tour
-- later is a one-line CHECK widen, the shape 017 used to add 'denied' and 020
-- used to add 'declined'.
--
-- 'content_approval' is listed NOW, before Tour 2 is built, on purpose: it
-- costs nothing, it documents that this table was designed for two tours, and
-- it means the deferred session touches no SQL.
alter table tour_completions drop constraint if exists tour_completions_tour_key_check;
alter table tour_completions add constraint tour_completions_tour_key_check
  check (tour_key in ('client_onboarding', 'content_approval'));

-- HOW it ended. Both values close the tour and both suppress a re-fire — the
-- gate tests for the ROW, never for this column — but they are different
-- answers to Kelsey's question. 'completed' means they read the whole thing;
-- 'skipped' means they dismissed it and have seen nothing. A roster that
-- counted a skip as onboarded would tell Kelsey a client understands the
-- portal when they closed the tour on step one.
--
-- NOT NULL, because a completion with no outcome is not a record. There is no
-- third value for "still in progress": a partially-viewed tour writes NO ROW,
-- so closing the tab mid-tour leaves the client un-toured and it fires again
-- next visit. That is deliberate — the row is written once, at the end, by
-- whichever exit the client took.
alter table tour_completions drop constraint if exists tour_completions_outcome_check;
alter table tour_completions add constraint tour_completions_outcome_check
  check (outcome in ('completed', 'skipped'));

-- Version must be a real build number. > 0 rather than >= 0 so an unset or
-- default-zero value from a miswired caller fails loudly here instead of
-- creating a phantom "version 0" cohort that no app constant will ever match
-- again — a row that suppresses nothing and re-fires the tour forever.
alter table tour_completions drop constraint if exists tour_completions_version_check;
alter table tour_completions add constraint tour_completions_version_check
  check (version > 0);

-- ----------------------------------------------------------------------------
-- NO ADDITIONAL INDEX, and this is a decision rather than an omission.
--
-- The gate read is the hot path — it runs on every client dashboard render —
-- and it is an exact three-column lookup:
--
--     select 1 from tour_completions
--     where clerk_user_id = $1 and tour_key = $2 and version = $3;
--
-- That is served completely by the UNIQUE constraint's own index, whose
-- columns are in exactly that order. A second index on (clerk_user_id) alone
-- would be a strict prefix of it and would never be chosen.
--
-- Kelsey's roster read (every completion for a tour, to see who is onboarded)
-- is a sequential scan, correctly: this table gains at most one row per person
-- per tour per version — low hundreds of rows over the portal's life — and
-- below a few thousand rows Postgres picks a seq scan over an index anyway.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- ROW-LEVEL SECURITY
--
-- Enabled with NO policies, following the 9 client-facing tables in 001 and
-- the 5 in 015. This table is client-facing: the client's own browser is what
-- triggers the write, through a server action.
--
-- With no policy present, RLS is fail-closed: any role WITHOUT the BYPASSRLS
-- attribute sees zero rows. The app reaches this table exclusively through the
-- Supabase service-role key, which HAS BYPASSRLS, so this is behaviorally
-- inert today — authorization is enforced in app code (lib/auth.ts,
-- lib/currentClient.ts). It is a defense-in-depth margin against a stray anon
-- / authenticated connection.
--
-- `enable row level security` is idempotent, so a re-run is a safe no-op and
-- no guard is needed.
-- ============================================================================
alter table tour_completions enable row level security;

-- ============================================================================
-- VERIFY — run after the migration; nothing below writes anything.
--
-- 1. The table exists with exactly these 6 columns (EXPECT EXACTLY THESE 6
--    ROWS, in this order):
--
--      select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'tour_completions'
--      order by ordinal_position;
--
--        id            | uuid                     | NO | gen_random_uuid()
--        clerk_user_id | text                     | NO | (null)
--        tour_key      | text                     | NO | (null)
--        version       | integer                  | NO | (null)
--        outcome       | text                     | NO | (null)
--        ended_at      | timestamp with time zone | NO | now()
--
-- 2. Every constraint on the table, listed BY TABLE (conrelid), not by name —
--    a name-only lookup cannot tell a constraint that was never added from one
--    that lives on some other table, and a DROP IF EXISTS against a misspelled
--    name no-ops without a word. EXPECT EXACTLY THESE 6 ROWS, in this order,
--    every one with convalidated = true:
--
--      select conname, contype, convalidated, pg_get_constraintdef(oid) as def
--      from pg_constraint
--      where conrelid = 'public.tour_completions'::regclass
--        and contype in ('p', 'u', 'f', 'c')
--      order by conname;
--
--        tour_completions_clerk_user_id_not_empty     c  CHECK (length(clerk_user_id) > 0)
--        tour_completions_outcome_check               c  CHECK (outcome = ANY (ARRAY['completed', 'skipped']))
--        tour_completions_pkey                        p  PRIMARY KEY (id)
--        tour_completions_tour_key_check              c  CHECK (tour_key = ANY (ARRAY['client_onboarding', 'content_approval']))
--        tour_completions_user_tour_version_unique    u  UNIQUE (clerk_user_id, tour_key, version)
--        tour_completions_version_check               c  CHECK (version > 0)
--
--    Postgres reprints the CHECK definitions with its own parentheses and
--    ::text casts; the shape is what matters. NOTE there is no 'f' row — the
--    absence of a foreign key is intentional and documented above; if one
--    appears, that is the finding. The contype filter drops the not-null rows
--    Postgres 18 adds to pg_constraint (contype 'n'); on 15/17 it changes
--    nothing. A 7th row, or a 5th, is the finding — say which.
--
-- 3. The UNIQUE's backing index exists and is the only index on the table
--    besides the primary key (EXPECT EXACTLY THESE 2 ROWS):
--
--      select indexname, indexdef
--      from pg_indexes
--      where schemaname = 'public' and tablename = 'tour_completions'
--      order by indexname;
--
--        tour_completions_pkey                      CREATE UNIQUE INDEX ... USING btree (id)
--        tour_completions_user_tour_version_unique  CREATE UNIQUE INDEX ... USING btree (clerk_user_id, tour_key, version)
--
-- 4. RLS is on, with no policies (EXPECT relrowsecurity = true, and ZERO
--    policy rows):
--
--      select relrowsecurity from pg_class
--      where oid = 'public.tour_completions'::regclass;
--
--      select policyname from pg_policies
--      where schemaname = 'public' and tablename = 'tour_completions';
--
-- 5. Nobody is toured yet — nothing in this file writes a row, and no code
--    writes one until the tour UI ships (EXPECT ZERO):
--
--      select count(*) from tour_completions;
-- ============================================================================
