-- 015_content_approval.sql
-- Content & Approval feature, Phase 1: schema only.
-- See docs/DBS_Content_Approval_Feature.md §3.8 for the data model and
-- docs/content-approval-integration-audit.md for the integration findings.
--
-- PURELY ADDITIVE: five new tables (content_cycles, content_items,
-- content_assets, revision_rounds, revision_notes) plus one new private
-- Storage bucket (content-assets). No existing table or column is modified,
-- no DROP, no destructive ALTER, no data writes. Safe to run top-to-bottom in
-- the Supabase SQL Editor.
--
-- Conventions match 001_initial_schema.sql: text + CHECK (no PG enums), no
-- triggers and no functions, FKs inline, CHECKs as separate named constraints
-- applied with DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT, RLS enabled with
-- NO policies (service-role-only), idempotent guards throughout.
--
-- Tables are created in FK-safe order: content_cycles -> content_items ->
-- content_assets -> revision_rounds -> revision_notes.
--
-- NOTHING IN THIS MIGRATION IS READ BY THE APP YET. It ships ahead of the
-- owner UI; an empty set of these tables is the correct steady state until
-- the Phase 1 CRUD surface lands.

-- ----------------------------------------------------------------------------
-- content_cycles — one client, one month. The unit that gets released,
-- deadlined, and locked. `month` is the FIRST OF THE MONTH (a plain date, not
-- a timestamptz — a calendar month has no instant), and
-- UNIQUE(client_id, month) is what enforces "one row per client per month" at
-- the DB level.
--
-- revision_deadline is nullable: it is set at Release time, not at creation,
-- so a cycle sits in 'drafting' with no deadline while Kelsey builds it.
--
-- included_rounds / extra_round_price are SNAPSHOTS of the billing terms for
-- this cycle, so changing a package price later never re-prices a month that
-- has already been released.
-- ----------------------------------------------------------------------------
create table if not exists content_cycles (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references clients(id) on delete cascade,
  month              date not null,
  revision_deadline  timestamptz,
  included_rounds    int not null default 1,
  extra_round_price  numeric,
  status             text not null default 'drafting',
  created_at         timestamptz not null default now(),
  constraint content_cycles_client_month_unique unique (client_id, month)
);

alter table content_cycles drop constraint if exists content_cycles_status_check;
alter table content_cycles add constraint content_cycles_status_check
  check (status in ('drafting', 'in_review', 'locked'));

create index if not exists content_cycles_client_id_idx
  on content_cycles (client_id);

-- ----------------------------------------------------------------------------
-- content_items — one scheduled post. client_id is denormalized alongside
-- cycle_id (spec §3.8) so every ownership check stays a single-table filter,
-- matching the ownership-baked-into-the-query convention used by the invoice
-- and file reads. Both FKs cascade: deleting a cycle deletes its items.
--
-- scheduled_for is a timestamptz holding a PORTAL_TIMEZONE wall-clock instant
-- built via combineDateAndTimeInTimezone — see spec §3.9's timezone note.
--
-- current_round tracks which revision round this item is on; round 1 is
-- included, 2+ is billable. approved_by is free text rather than a FK because
-- the daily deadline sweep writes the literal 'auto' (spec §3.9).
-- ----------------------------------------------------------------------------
create table if not exists content_items (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients(id) on delete cascade,
  cycle_id       uuid not null references content_cycles(id) on delete cascade,
  scheduled_for  timestamptz not null,
  platform       text not null,
  format         text not null,
  caption        text,
  status         text not null default 'draft',
  current_round  int not null default 1,
  approved_at    timestamptz,
  approved_by    text,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

alter table content_items drop constraint if exists content_items_platform_check;
alter table content_items add constraint content_items_platform_check
  check (platform in ('instagram', 'tiktok', 'facebook', 'youtube', 'pinterest'));

alter table content_items drop constraint if exists content_items_format_check;
alter table content_items add constraint content_items_format_check
  check (format in ('reel', 'feed', 'story', 'carousel'));

alter table content_items drop constraint if exists content_items_status_check;
alter table content_items add constraint content_items_status_check
  check (status in ('draft', 'in_review', 'changes_requested', 'approved', 'published'));

create index if not exists content_items_client_id_idx
  on content_items (client_id);
create index if not exists content_items_cycle_id_idx
  on content_items (cycle_id);
-- Calendar range scans and the daily deadline sweep both filter on this.
create index if not exists content_items_scheduled_for_idx
  on content_items (scheduled_for);

-- ----------------------------------------------------------------------------
-- content_assets — the media on an item. A separate table because a carousel
-- is multi-asset; `position` orders them (0-based; a single-asset item is
-- position 0). `position` is a non-reserved keyword in Postgres and is legal
-- unquoted as a column name.
--
-- provider + external_id are a two-column polymorphic reference:
--   provider='stream'   -> external_id is the Cloudflare Stream video UID
--   provider='supabase' -> external_id is the object key in the
--                          `content-assets` bucket created at the bottom of
--                          this file (NOT the `client-files` bucket — review
--                          media is deliberately kept out of the client-facing
--                          Files feature, which lists rows from `files`).
--
-- replaced_at is soft version history: when Kelsey accepts a revision the
-- superseded asset row is stamped rather than deleted, so the old/new
-- comparison survives. NULL = current. The Stream object itself must still be
-- explicitly deleted (spec §3.5c) — nothing in the database protects against
-- that leak.
--
-- status carries the async-transcoding state required by spec §3.5b: upload
-- completion and playability are separate events. It DEFAULTS TO 'ready' so a
-- Supabase photo upload — which is playable the instant it lands — needs no
-- special handling; only Stream video ever inserts as 'processing' and is
-- flipped once `readyToStream` goes true. Release is blocked while any asset
-- in the cycle is not 'ready', otherwise clients open dead players.
-- ----------------------------------------------------------------------------
create table if not exists content_assets (
  id                uuid primary key default gen_random_uuid(),
  content_item_id   uuid not null references content_items(id) on delete cascade,
  position          int not null default 0,
  kind              text not null,
  provider          text not null,
  external_id       text not null,
  status            text not null default 'ready',
  duration_seconds  numeric,
  width             int,
  height            int,
  bytes             bigint,
  replaced_at       timestamptz,
  created_at        timestamptz not null default now()
);

alter table content_assets drop constraint if exists content_assets_kind_check;
alter table content_assets add constraint content_assets_kind_check
  check (kind in ('video', 'image'));

alter table content_assets drop constraint if exists content_assets_provider_check;
alter table content_assets add constraint content_assets_provider_check
  check (provider in ('stream', 'supabase'));

alter table content_assets drop constraint if exists content_assets_status_check;
alter table content_assets add constraint content_assets_status_check
  check (status in ('processing', 'ready', 'failed'));

create index if not exists content_assets_content_item_id_idx
  on content_assets (content_item_id);

-- At most ONE CURRENT asset per position on an item. PARTIAL (not a plain
-- unique index) because replaced_at versioning deliberately keeps superseded
-- rows at the same position — only the live set is constrained. This is the
-- guard that makes an accept-a-revision flow fail loudly if it inserts the
-- replacement without stamping replaced_at on the asset it supersedes.
create unique index if not exists content_assets_current_position_idx
  on content_assets (content_item_id, position) where replaced_at is null;

-- ----------------------------------------------------------------------------
-- revision_rounds — the atomic billing unit: one batch of change requests on
-- one item. round_number 1 is included; 2+ is billable, with `price` snapshot
-- from content_cycles.extra_round_price at submission time.
--
-- submitted_at / submitted_by stay NULL while the client is still assembling
-- the round; a non-NULL submitted_at is what makes the round visible to
-- Kelsey and locks the item on the client side (spec §5.4).
--
-- invoice_id is the only FK this feature points at a pre-existing table, and
-- it is SET NULL rather than CASCADE: deleting an invoice must not silently
-- delete the record of a revision that actually happened — it just returns
-- the round to the unbilled pool.
--
-- UNIQUE(content_item_id, round_number) makes round numbering exclusive per
-- item: a double-submit cannot open two round-2 rows on the same item and
-- accrue two billable charges for one batch of feedback.
-- ----------------------------------------------------------------------------
create table if not exists revision_rounds (
  id               uuid primary key default gen_random_uuid(),
  content_item_id  uuid not null references content_items(id) on delete cascade,
  round_number     int not null default 1,
  is_billable      boolean not null default false,
  price            numeric,
  submitted_at     timestamptz,
  submitted_by     text,
  status           text not null default 'open',
  resolved_at      timestamptz,
  invoice_id       uuid references invoices(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint revision_rounds_item_round_unique unique (content_item_id, round_number)
);

alter table revision_rounds drop constraint if exists revision_rounds_status_check;
alter table revision_rounds add constraint revision_rounds_status_check
  check (status in ('open', 'addressed'));

create index if not exists revision_rounds_content_item_id_idx
  on revision_rounds (content_item_id);
-- Partial index for the accrued-unbilled-charges lookup (spec §6.2:
-- is_billable and invoice_id is null and status='addressed'), matching the
-- partial-index pattern used for time_logs.source_todo_id in 006.
create index if not exists revision_rounds_unbilled_idx
  on revision_rounds (content_item_id) where invoice_id is null;

-- ----------------------------------------------------------------------------
-- revision_notes — children of a round. One note = one piece of feedback in
-- one category. timestamp_seconds is nullable and only meaningful for
-- scrubber comments on a video asset (numeric, not int — sub-second scrub
-- positions).
-- ----------------------------------------------------------------------------
create table if not exists revision_notes (
  id                 uuid primary key default gen_random_uuid(),
  round_id           uuid not null references revision_rounds(id) on delete cascade,
  category           text not null,
  timestamp_seconds  numeric,
  body               text not null,
  created_at         timestamptz not null default now()
);

alter table revision_notes drop constraint if exists revision_notes_category_check;
alter table revision_notes add constraint revision_notes_category_check
  check (category in ('clips', 'caption', 'music', 'pacing', 'text_overlay',
                      'cover', 'schedule', 'other'));

create index if not exists revision_notes_round_id_idx
  on revision_notes (round_id);

-- ============================================================================
-- STORAGE BUCKET — content-assets
--
-- The private bucket backing `content_assets` rows with provider='supabase'
-- (photo posts and carousel stills; video lives in Cloudflare Stream). A
-- SECOND bucket, deliberately separate from `client-files`: review media is
-- work-in-progress, and client-files is surfaced directly by the Files
-- feature. No RLS, no public access — reads and writes go through signed URLs
-- minted server-side by the service-role client (see lib/storage.ts).
--
-- NOTE: `storage.buckets` is owned by the storage schema. Run this from the
-- Supabase SQL Editor, which executes as the `postgres` role and can insert
-- here. A restricted migration runner / non-superuser role may lack INSERT on
-- storage.buckets — if so, grant the privilege or run this statement as
-- `postgres`. The bucket may also be created once via the Supabase dashboard;
-- the ON CONFLICT clause makes this a no-op in that case.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('content-assets', 'content-assets', false)
on conflict (id) do nothing;

-- ============================================================================
-- ROW-LEVEL SECURITY
--
-- Enabled with NO policies on all five new tables. These are client-facing,
-- so they follow the 9 client-facing tables in 001 rather than the six tables
-- intentionally left without RLS.
--
-- With no policy present, RLS is fail-closed: any role WITHOUT the BYPASSRLS
-- attribute sees zero rows. The app reaches these tables exclusively through
-- the Supabase service-role key, which HAS BYPASSRLS, so this is behaviorally
-- inert today — authorization is enforced in app code (lib/auth.ts,
-- lib/currentClient.ts). It is a defense-in-depth margin against a stray anon
-- / authenticated connection.
--
-- `enable row level security` is idempotent, so a re-run is a safe no-op and
-- no guard is needed.
-- ============================================================================
alter table content_cycles  enable row level security;
alter table content_items   enable row level security;
alter table content_assets  enable row level security;
alter table revision_rounds enable row level security;
alter table revision_notes  enable row level security;
