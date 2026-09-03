-- 017_revision_resolution.sql
-- Content & Approval feature, Phase 6: accept / deny / replace / re-release.
-- See docs/DBS_Content_Approval_Feature.md §4.7–4.8 and the Phase 6 section of
-- docs/DBS_Content_Approval_Build_Plan.md.
--
-- PURELY ADDITIVE: one new column on revision_rounds, one new column on
-- content_assets, one widened CHECK, three new CHECKs, one self-referencing
-- FK. No table is created or dropped, no existing column is modified, no data
-- is written. Safe to run top-to-bottom in the Supabase SQL Editor, and safe
-- to re-run.
--
-- Conventions match 015/016: text + CHECK (no PG enums), no triggers and no
-- functions, DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT idempotency, ADD
-- COLUMN IF NOT EXISTS. RLS is already enabled (no policies) on both tables
-- by 015; no new tables here, so no RLS block.
--
-- Every constraint below validates cleanly against existing rows: no live row
-- has status='denied', a resolution_note, or a replaces_asset_id, because
-- none of the three existed before this file.

-- ----------------------------------------------------------------------------
-- revision_rounds.status — third value: 'denied'.
--
-- Spec §4.7: for each submitted item Kelsey can ACCEPT or DENY the revision
-- request. 015 shipped only ('open','addressed') — accept was representable,
-- deny was not (the client-side pill map records the gap in its own words:
-- "'Kept as planned' (a denied request — Phase 6 has no column for it)",
-- app/client/review/_lib/format.ts).
--
-- 'denied' is a STATUS, not a flag on 'addressed', for two downstream reads:
--
--   1. Phase 8's accrual query (spec §6.2) selects `is_billable AND
--      invoice_id IS NULL AND status='addressed'` — a denied round falls out
--      of the billable pool by its own status, with no extra predicate to
--      forget.
--   2. The fully-denied-round exemption (spec §6.1: "a round in which every
--      item was denied by Kelsey is not billed") becomes a pure read: cycle
--      round N is exempt when every submitted round with that round_number in
--      the cycle is 'denied'. Phase 6 records the state; Phase 8 computes it.
--
-- Deny is FINAL and writes nothing to content_items: the item stays
-- 'changes_requested' and the client's "Kept as planned" state derives from
-- its latest submitted round being 'denied' (decided 2026-08-31, Step 1
-- review). PHASE 7 HAND-OFF: the deadline sweep must not let its
-- approved_by='auto' flip override that rendering — the round row is the
-- record that distinguishes a denied item from an untouched one.
-- ----------------------------------------------------------------------------
alter table revision_rounds drop constraint if exists revision_rounds_status_check;
alter table revision_rounds add constraint revision_rounds_status_check
  check (status in ('open', 'addressed', 'denied'));

-- ----------------------------------------------------------------------------
-- revision_rounds.resolution_note — Kelsey's words on the resolution.
--
-- Two client-facing renders share this one column (copy deck, Screen 5):
--
--   denied    -> the "A note from Kelsey" reason on the declined state.
--               REQUIRED — spec §4.7 says deny "requires a written reason"
--               and the client always sees it; the deck marks the label
--               "Required, not optional".
--   addressed -> the OPTIONAL "A note from Kelsey" on the updated state
--               ("Kelsey updated this post"), shown after re-release opens
--               the next round.
--
-- Free text in Kelsey's own voice, rendered as-is. Nullable, because null is
-- the normal state for every open round and for an accept she attaches no
-- note to.
-- ----------------------------------------------------------------------------
alter table revision_rounds add column if not exists resolution_note text;

-- A deny always carries its reason. This is what makes "written reason
-- required" STRUCTURAL rather than a UI promise — a code path that flips a
-- round to 'denied' without the note fails loudly here instead of shipping a
-- declined state whose required label has nothing under it.
alter table revision_rounds drop constraint if exists revision_rounds_denied_reason_check;
alter table revision_rounds add constraint revision_rounds_denied_reason_check
  check (status <> 'denied' or resolution_note is not null);

-- And the inverse scope rule: a note belongs to a RESOLUTION and to nothing
-- else. An open round with a stray note would render as if Kelsey had already
-- answered; clearing-on-reopen is not a thing (rounds never reopen), so the
-- only honest write order is note-with-resolution, enforced here.
alter table revision_rounds drop constraint if exists revision_rounds_resolution_note_scope_check;
alter table revision_rounds add constraint revision_rounds_resolution_note_scope_check
  check (resolution_note is null or status in ('addressed', 'denied'));

-- ----------------------------------------------------------------------------
-- content_assets.replaces_asset_id — the explicit staging marker for the
-- accept-a-revision replacement upload.
--
-- WHY STAGING EXISTS AT ALL. Two invariants collide on the replacement path:
--
--   1. Phase 2's leak rule: the content_assets row is written AT MINT, before
--      a byte moves, so Postgres records every Stream UID this app ever
--      creates (spec §3.5c — an uploaded video with no row is the one
--      unrecoverable failure).
--   2. 015's partial unique index: at most one live row per
--      (content_item_id, position). The replacement targets the SAME position
--      as the video it supersedes, so it cannot be inserted live while the
--      old row is live — the index rejects it, by design.
--
-- So the replacement row is born STAGED: same position as its target,
-- replaced_at set at birth (which is what dodges the partial index), and
-- replaces_asset_id pointing at the asset it will supersede. Because
-- replaced_at is non-null, every existing read — the client queue, the
-- release gate, the owner previews — filters the staged row out with no code
-- change: the client never sees a half-arrived candidate.
--
-- The accept commit then swaps: stamp the old row's replaced_at, and activate
-- the staged row by clearing BOTH replaced_at and replaces_asset_id in one
-- UPDATE. The partial index re-checks on that update, so activation
-- physically cannot land before the old row is stamped.
--
-- THE MARKER IS A COLUMN, NOT A TIMESTAMP TRICK, on purpose: a staged row and
-- a genuine history row both carry a non-null replaced_at, and telling them
-- apart by replaced_at = created_at equality is cleverness a later reader
-- will misread. replaces_asset_id makes staged rows queryable
-- (`replaces_asset_id IS NOT NULL`), which is what keeps an ABANDONED
-- replacement discoverable and removable in the owner panel instead of
-- billing Stream storage invisibly — the same silent-leak failure mode,
-- entering through a side door.
--
-- Life cycle of the column's value:
--   staged     -> non-null (and replaced_at non-null; the CHECK below)
--   activated  -> cleared in the activation UPDATE; a live row never carries it
--   history    -> null (superseded rows keep replaced_at only)
--
-- ON DELETE SET NULL, not cascade: cascade-deleting a staged row when its
-- target is removed would take the ROW and leave the VIDEO — the exact
-- inversion of the delete ordering this feature exists to protect (a Stream
-- delete must always happen before the row that holds its UID goes away).
-- SET NULL degrades the staged row into an ordinary superseded-looking row
-- that still holds its UID, so the item/cycle delete sweeps still find and
-- delete the video. The app layer additionally refuses to delete an asset
-- that has a staged replacement pointing at it, so this FK action is a
-- backstop, not a path.
--
-- No new index: staged-row lookups filter on content_item_id first, which
-- content_assets_content_item_id_idx (015) already serves, and an item holds
-- a handful of rows.
-- ----------------------------------------------------------------------------
alter table content_assets add column if not exists replaces_asset_id uuid;

alter table content_assets drop constraint if exists content_assets_replaces_asset_id_fkey;
alter table content_assets add constraint content_assets_replaces_asset_id_fkey
  foreign key (replaces_asset_id) references content_assets(id) on delete set null;

-- A staged row is never live: carrying replaces_asset_id requires a non-null
-- replaced_at. This makes the swap ordering structural — the activation
-- UPDATE must clear the marker in the same statement that clears replaced_at,
-- and a code path that tries to activate without clearing it fails loudly
-- here.
alter table content_assets drop constraint if exists content_assets_staged_not_live_check;
alter table content_assets add constraint content_assets_staged_not_live_check
  check (replaces_asset_id is null or replaced_at is not null);

-- ============================================================================
-- VERIFY — run after the migration; nothing below writes anything.
--
-- 1. Both new columns exist (each SELECT errors on a missing column; zero
--    rows back is fine, the tables may be empty):
--
--      select resolution_note from revision_rounds limit 1;
--      select replaces_asset_id from content_assets limit 1;
--
-- 2. All five constraints are in place (EXPECT EXACTLY THESE 5 ROWS, in this
--    order):
--
--      select conname
--      from pg_constraint
--      where conname in (
--        'content_assets_replaces_asset_id_fkey',
--        'content_assets_staged_not_live_check',
--        'revision_rounds_denied_reason_check',
--        'revision_rounds_resolution_note_scope_check',
--        'revision_rounds_status_check'
--      )
--      order by conname;
--
-- 3. The widened status CHECK admits 'denied' (EXPECT the definition to list
--    'open', 'addressed', 'denied'):
--
--      select pg_get_constraintdef(oid)
--      from pg_constraint
--      where conname = 'revision_rounds_status_check';
-- ============================================================================
