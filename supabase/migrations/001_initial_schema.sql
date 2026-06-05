-- ============================================================================
-- Digital Bloom Socials — Portal: Consolidated Initial Schema
--
-- This is the single, canonical schema migration. It SUPERSEDES the previous
-- multi-file setup — the old `supabase/schema.sql` plus migrations
-- `001_phase4_suggestions.sql`, `002_files_storage.sql`, and `003_invoices.sql`
-- — all of which are retained for history only under
-- `supabase/migrations/_archive/`. Do not run the archived files.
--
-- Idempotent by construction: running this file top-to-bottom against an empty
-- Postgres database reproduces the exact current production schema, and
-- re-running it against an already-migrated database is a safe no-op.
--   * Tables       — guarded by CREATE TABLE IF NOT EXISTS.
--   * Indexes      — guarded by CREATE INDEX IF NOT EXISTS.
--   * CHECK / enum — applied with DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT,
--                    so the final value-set always wins, even on a DB that
--                    still carries an older constraint definition.
--
-- DESIGN NOTES — all intentional, do not "fix":
--   * ROW-LEVEL SECURITY is enabled — with NO policies — on the 9 client-facing
--     tables as a fail-closed safety default (see the RLS section at the end of
--     this file). Every table is still reached exclusively through the Supabase
--     service-role client, which BYPASSES RLS, so this is behaviorally inert
--     today; authorization is enforced in app code.
--   * NO triggers and NO stored functions. Derived values (e.g.
--     app_settings.updated_at) are written by the application layer.
--   * NO Postgres enum types. Every "enum" is a text column plus a CHECK
--     constraint — cheaper to evolve than ALTER TYPE ... ADD VALUE.
--
-- RUN ORDER (Supabase SQL Editor):
--   1. this file                      — schema
--   2. supabase/seed.sql              — package tiers       (one-shot, NOT idempotent)
--   3. supabase/seed-financials.sql   — financial backfill  (one-shot, NOT idempotent)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- TABLES + CONSTRAINTS + INDEXES
-- Created in FK-safe order: a table is never referenced before it exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- clients
--
-- SOFT-DELETE ONLY. The FKs from projects / shoots / time_logs / invoices /
-- messages / files cascade on client delete — losing time_logs is a real
-- tax-audit risk for an hourly-billed service business. The app NEVER issues
-- `DELETE FROM clients`; deactivation sets status='inactive' and bans the
-- Clerk user (see app/owner/clients/_actions.ts). The cascades are defensive.
--
-- The two `*_new_msg_email_at` and two `*_reminder_email_at` columns drive
-- independent 24h notification cooldowns (new-message emails vs. the daily
-- reminder cron). All four nullable.
-- ----------------------------------------------------------------------------
create table if not exists clients (
  id                             uuid primary key default gen_random_uuid(),
  name                           text not null,
  email                          text not null unique,
  clerk_user_id                  text unique,
  type                           text not null,
  status                         text not null default 'onboarding',
  created_at                     timestamptz not null default now(),
  owner_last_new_msg_email_at    timestamptz,
  client_last_new_msg_email_at   timestamptz,
  owner_last_reminder_email_at   timestamptz,
  client_last_reminder_email_at  timestamptz
);

alter table clients drop constraint if exists clients_type_check;
alter table clients add constraint clients_type_check
  check (type in ('brand', 'bride'));

alter table clients drop constraint if exists clients_status_check;
alter table clients add constraint clients_status_check
  check (status in ('active', 'onboarding', 'inactive', 'lead'));

-- Reject empty-string clerk_user_id (NULL is fine; an empty string would
-- silently break IS NULL queries and the unique constraint).
alter table clients drop constraint if exists clerk_user_id_not_empty;
alter table clients add constraint clerk_user_id_not_empty
  check (clerk_user_id is null or length(clerk_user_id) > 0);

-- ----------------------------------------------------------------------------
-- packages
-- ----------------------------------------------------------------------------
create table if not exists packages (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  tier               text not null,
  monthly_hours      numeric not null,
  monthly_price      numeric not null,
  deliverables_list  text[] not null default '{}',
  created_at         timestamptz not null default now()
);

alter table packages drop constraint if exists packages_tier_check;
alter table packages add constraint packages_tier_check
  check (tier in ('starter', 'growth', 'premium'));

-- ----------------------------------------------------------------------------
-- projects
-- ----------------------------------------------------------------------------
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  package_id      uuid references packages(id) on delete set null,
  start_date      date,
  current_phase   text not null default 'onboarding',
  notes           text,
  status          text not null default 'active',
  created_at      timestamptz not null default now()
);

alter table projects drop constraint if exists projects_current_phase_check;
alter table projects add constraint projects_current_phase_check
  check (current_phase in ('onboarding', 'strategy', 'content', 'reporting'));

alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check
  check (status in ('active', 'paused', 'completed'));

create index if not exists projects_client_id_idx on projects (client_id);

-- ----------------------------------------------------------------------------
-- shoots
--
-- kind='shoot' = a content shoot / filming day; kind='meeting' = a zoom /
-- phone / in-person meeting. meeting_type is only meaningful (and only
-- allowed) when kind='meeting'.
-- ----------------------------------------------------------------------------
create table if not exists shoots (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  project_id       uuid references projects(id) on delete set null,
  scheduled_at     timestamptz not null,
  location         text,
  duration_hours   numeric,
  status           text not null default 'requested',
  notes            text,
  kind             text not null default 'shoot',
  meeting_type     text,
  created_at       timestamptz not null default now()
);

alter table shoots drop constraint if exists shoots_status_check;
alter table shoots add constraint shoots_status_check
  check (status in ('requested', 'confirmed', 'completed', 'cancelled'));

alter table shoots drop constraint if exists shoots_kind_check;
alter table shoots add constraint shoots_kind_check
  check (kind in ('shoot', 'meeting'));

alter table shoots drop constraint if exists shoots_meeting_type_check;
alter table shoots add constraint shoots_meeting_type_check
  check (meeting_type is null or meeting_type in ('zoom', 'phone', 'in_person'));

alter table shoots drop constraint if exists shoots_meeting_type_only_for_meetings;
alter table shoots add constraint shoots_meeting_type_only_for_meetings
  check ((kind = 'meeting') or (meeting_type is null));

create index if not exists shoots_client_id_idx on shoots (client_id);
create index if not exists shoots_scheduled_at_idx on shoots (scheduled_at);

-- ----------------------------------------------------------------------------
-- recurring_expense_templates — monthly subscriptions / recurring costs.
-- Each active template surfaces a per-month suggestion in /owner/financials.
-- ----------------------------------------------------------------------------
create table if not exists recurring_expense_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null,
  amount        numeric not null,
  day_of_month  smallint not null default 1,
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table recurring_expense_templates
  drop constraint if exists recurring_expense_templates_category_check;
alter table recurring_expense_templates
  add constraint recurring_expense_templates_category_check
  check (category in (
    'platform_software', 'marketing_advertising', 'equipment_gear',
    'travel_transportation', 'professional_services', 'business_operations'
  ));

alter table recurring_expense_templates
  drop constraint if exists recurring_expense_templates_amount_check;
alter table recurring_expense_templates
  add constraint recurring_expense_templates_amount_check
  check (amount > 0);

alter table recurring_expense_templates
  drop constraint if exists recurring_expense_templates_day_of_month_check;
alter table recurring_expense_templates
  add constraint recurring_expense_templates_day_of_month_check
  check (day_of_month between 1 and 28);

create index if not exists recurring_expense_templates_active_idx
  on recurring_expense_templates (active);

-- ----------------------------------------------------------------------------
-- invoices
--
-- invoice_number is human-readable (INV-YYYY-NNNN); uniqueness is enforced by
-- a partial unique index, not a DB sequence — the action layer assigns it.
-- sent_at stamps the draft -> sent transition (issued date is derived from it).
-- ----------------------------------------------------------------------------
create table if not exists invoices (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients(id) on delete cascade,
  amount                numeric not null,
  due_date              date,
  paid_at               timestamptz,
  status                text not null default 'draft',
  stripe_payment_link   text,
  line_items            jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  invoice_number        text,
  income_type           text not null default 'other',
  memo                  text,
  sent_at               timestamptz
);

alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check
  check (status in ('draft', 'sent', 'paid', 'overdue'));

alter table invoices drop constraint if exists invoices_income_type_check;
alter table invoices add constraint invoices_income_type_check
  check (income_type in (
    'brand_retainer', 'wedding_same_day', 'one_off_shoot', 'other'
  ));

create index if not exists invoices_client_id_idx on invoices (client_id);
create index if not exists invoices_status_idx on invoices (status);
create unique index if not exists invoices_invoice_number_idx
  on invoices (invoice_number)
  where invoice_number is not null;

-- ----------------------------------------------------------------------------
-- todos — owner task list (owner-only feature). Optional client_id ties a task
-- to a client and is what makes the Start-timer button available. category
-- mirrors time_logs.category exactly so it maps 1:1 on auto-log. status +
-- completed_at: app sets completed_at = now() when flipping to 'done', nulls it
-- on un-complete. Defined ahead of time_logs because time_logs.source_todo_id
-- and active_timer.todo_id both reference it.
-- ----------------------------------------------------------------------------
create table if not exists todos (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  client_id     uuid references clients(id) on delete set null,
  category      text,
  due_date      date,
  status        text not null default 'open',
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

alter table todos drop constraint if exists todos_category_check;
alter table todos add constraint todos_category_check
  check (category in ('editing', 'planning', 'filming', 'admin', 'communication'));

alter table todos drop constraint if exists todos_status_check;
alter table todos add constraint todos_status_check
  check (status in ('open', 'done'));

create index if not exists todos_client_id_idx on todos (client_id);

-- ----------------------------------------------------------------------------
-- active_timer — the single running timer (0 or 1 row). UNIQUE(singleton)
-- enforces at most one running timer at a time (same pattern as app_settings).
-- todo_id CASCADE: deleting the underlying task clears the timer row. client_id
-- / category are SNAPSHOTS captured at Start so the auto-log stays correct even
-- if the task is edited mid-run. No row = nothing running; elapsed = now() −
-- started_at.
-- ----------------------------------------------------------------------------
create table if not exists active_timer (
  id          uuid primary key default gen_random_uuid(),
  singleton   boolean not null default true,
  todo_id     uuid not null references todos(id) on delete cascade,
  client_id   uuid references clients(id) on delete set null,
  category    text,
  started_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint active_timer_singleton_unique unique (singleton)
);

alter table active_timer drop constraint if exists active_timer_category_check;
alter table active_timer add constraint active_timer_category_check
  check (category in ('editing', 'planning', 'filming', 'admin', 'communication'));

-- ----------------------------------------------------------------------------
-- time_logs
--
-- source_todo_id is provenance for timer auto-logs (matching the source_shoot_id
-- / source_template_id pattern): lets a task sum its logged time, and lets logs
-- survive task deletion (SET NULL rather than cascade).
-- ----------------------------------------------------------------------------
create table if not exists time_logs (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  logged_by       text not null,
  date            date not null,
  hours           numeric not null,
  category        text not null,
  notes           text,
  created_at      timestamptz not null default now(),
  source_todo_id  uuid references todos(id) on delete set null
);

alter table time_logs drop constraint if exists time_logs_category_check;
alter table time_logs add constraint time_logs_category_check
  check (category in ('editing', 'planning', 'filming', 'admin', 'communication'));

create index if not exists time_logs_client_id_idx on time_logs (client_id);
create index if not exists time_logs_date_idx on time_logs (date);
create index if not exists time_logs_source_todo_id_idx
  on time_logs (source_todo_id) where source_todo_id is not null;

-- ----------------------------------------------------------------------------
-- expenses
--
-- source_template_id links a row back to the recurring template that produced
-- it (NULL = manually entered).
-- ----------------------------------------------------------------------------
create table if not exists expenses (
  id                  uuid primary key default gen_random_uuid(),
  category            text not null,
  description         text,
  amount              numeric not null,
  date                date not null,
  receipt_url         text,
  notes               text,
  created_at          timestamptz not null default now(),
  source_template_id  uuid references recurring_expense_templates(id) on delete set null
);

alter table expenses drop constraint if exists expenses_category_check;
alter table expenses add constraint expenses_category_check
  check (category in (
    'platform_software', 'marketing_advertising', 'equipment_gear',
    'travel_transportation', 'professional_services', 'business_operations'
  ));

create index if not exists expenses_date_idx on expenses (date);
create index if not exists expenses_source_template_id_idx
  on expenses (source_template_id) where source_template_id is not null;

-- ----------------------------------------------------------------------------
-- messages
-- ----------------------------------------------------------------------------
create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  sender_role  text not null,
  body         text not null,
  sent_at      timestamptz not null default now(),
  read_at      timestamptz
);

alter table messages drop constraint if exists messages_sender_role_check;
alter table messages add constraint messages_sender_role_check
  check (sender_role in ('owner', 'client'));

create index if not exists messages_client_id_idx on messages (client_id);
create index if not exists messages_sent_at_idx on messages (sent_at);

-- ----------------------------------------------------------------------------
-- files
--
-- storage_path is the canonical key in the `client-files` Storage bucket;
-- `name` carries the human-readable filename. mime_type / size_bytes are
-- persisted from verified storage-object metadata at finalize time.
-- ----------------------------------------------------------------------------
create table if not exists files (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null,
  storage_path  text not null,
  file_type     text not null,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   text not null,
  mime_type     text not null,
  size_bytes    bigint not null
);

alter table files drop constraint if exists files_file_type_check;
alter table files add constraint files_file_type_check
  check (file_type in ('content', 'contract', 'invoice', 'other'));

create index if not exists files_client_id_idx on files (client_id);

-- ----------------------------------------------------------------------------
-- time_blocks
--
-- One row = one fixed-time event on Kelsey's calendar that isn't a shoot:
-- a sonography shift, a manual work block, or a personal "blocked" window.
-- All times are wall-clock in PORTAL_TIMEZONE (America/Chicago). client_id is
-- only set (and only allowed) when category='work_block'.
-- ----------------------------------------------------------------------------
create table if not exists time_blocks (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  category    text not null,
  client_id   uuid references clients(id) on delete set null,
  label       text,
  notes       text,
  created_at  timestamptz not null default now()
);

alter table time_blocks drop constraint if exists time_blocks_category_check;
alter table time_blocks add constraint time_blocks_category_check
  check (category in ('sonography', 'work_block', 'blocked'));

alter table time_blocks drop constraint if exists time_blocks_times_consistent;
alter table time_blocks add constraint time_blocks_times_consistent
  check (end_time > start_time);

alter table time_blocks drop constraint if exists time_blocks_client_only_for_work;
alter table time_blocks add constraint time_blocks_client_only_for_work
  check ((category = 'work_block') or (client_id is null));

create index if not exists time_blocks_date_idx on time_blocks (date);
create index if not exists time_blocks_client_id_idx
  on time_blocks (client_id) where client_id is not null;

-- ----------------------------------------------------------------------------
-- app_settings — single-row owner config. The `singleton` column + unique
-- constraint enforce that only one row can ever exist. Read via `limit 1` /
-- `maybeSingle()`. The row is seeded at the bottom of this file.
-- ----------------------------------------------------------------------------
create table if not exists app_settings (
  id                     uuid primary key default gen_random_uuid(),
  singleton              boolean not null default true,
  home_address           text not null default '',
  mileage_rate_per_mile  numeric not null default 0.70,
  tax_set_aside_percent  numeric not null default 28,
  updated_at             timestamptz not null default now(),
  constraint app_settings_singleton_unique unique (singleton)
);

alter table app_settings drop constraint if exists app_settings_mileage_rate_per_mile_check;
alter table app_settings add constraint app_settings_mileage_rate_per_mile_check
  check (mileage_rate_per_mile >= 0);

alter table app_settings drop constraint if exists app_settings_tax_set_aside_percent_check;
alter table app_settings add constraint app_settings_tax_set_aside_percent_check
  check (tax_set_aside_percent >= 0 and tax_set_aside_percent <= 100);

-- ----------------------------------------------------------------------------
-- income_payments — money received. Distinct from `invoices` (which tracks
-- billing status). client_name_snapshot is captured at write time so the row
-- survives a client deletion. source/invoice_id link a row back to the
-- invoice or suggestion that produced it (NULL = manual entry).
-- ----------------------------------------------------------------------------
create table if not exists income_payments (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid references clients(id) on delete set null,
  client_name_snapshot  text not null,
  payment_date          date not null,
  amount                numeric not null,
  income_type           text not null,
  payment_method        text,
  notes                 text,
  logged_by             text not null,
  created_at            timestamptz not null default now(),
  source                text,
  invoice_id            uuid references invoices(id) on delete set null
);

alter table income_payments drop constraint if exists income_payments_amount_check;
alter table income_payments add constraint income_payments_amount_check
  check (amount > 0);

alter table income_payments drop constraint if exists income_payments_income_type_check;
alter table income_payments add constraint income_payments_income_type_check
  check (income_type in (
    'brand_retainer', 'wedding_same_day', 'one_off_shoot', 'other'
  ));

alter table income_payments drop constraint if exists income_payments_source_check;
alter table income_payments add constraint income_payments_source_check
  check (source is null or source in ('manual', 'suggested_retainer', 'invoice'));

create index if not exists income_payments_payment_date_idx
  on income_payments (payment_date);
create index if not exists income_payments_client_id_idx
  on income_payments (client_id);
create index if not exists income_payments_income_type_idx
  on income_payments (income_type);
create index if not exists income_payments_invoice_id_idx
  on income_payments (invoice_id);

-- ----------------------------------------------------------------------------
-- mileage_logs — raw mileage entries. rate_per_mile is a snapshot of
-- app_settings.mileage_rate_per_mile at logging time so historical entries
-- don't shift when the IRS rate changes. source_shoot_id links a row to the
-- shoot that produced it (NULL = manual entry).
-- ----------------------------------------------------------------------------
create table if not exists mileage_logs (
  id              uuid primary key default gen_random_uuid(),
  trip_date       date not null,
  from_address    text not null,
  to_address      text not null,
  start_odometer  numeric,
  end_odometer    numeric,
  miles           numeric not null,
  rate_per_mile   numeric not null,
  client_id       uuid references clients(id) on delete set null,
  notes           text,
  logged_by       text not null,
  created_at      timestamptz not null default now(),
  source_shoot_id uuid references shoots(id) on delete set null
);

alter table mileage_logs drop constraint if exists mileage_logs_start_odometer_check;
alter table mileage_logs add constraint mileage_logs_start_odometer_check
  check (start_odometer is null or start_odometer >= 0);

alter table mileage_logs drop constraint if exists mileage_logs_end_odometer_check;
alter table mileage_logs add constraint mileage_logs_end_odometer_check
  check (end_odometer is null or end_odometer >= 0);

alter table mileage_logs drop constraint if exists mileage_logs_miles_check;
alter table mileage_logs add constraint mileage_logs_miles_check
  check (miles > 0);

alter table mileage_logs drop constraint if exists mileage_logs_rate_per_mile_check;
alter table mileage_logs add constraint mileage_logs_rate_per_mile_check
  check (rate_per_mile >= 0);

create index if not exists mileage_logs_trip_date_idx on mileage_logs (trip_date);
create index if not exists mileage_logs_client_id_idx on mileage_logs (client_id);
create index if not exists mileage_logs_source_shoot_id_idx
  on mileage_logs (source_shoot_id) where source_shoot_id is not null;

-- ----------------------------------------------------------------------------
-- dismissed_suggestions — per-month dismissals of auto-generated financials
-- suggestions. reference_id is polymorphic (client / shoot / template id,
-- depending on `type`) and intentionally has NO foreign key. period_yyyymm is
-- a wall-clock month key in PORTAL_TIMEZONE, e.g. '2026-05'.
-- ----------------------------------------------------------------------------
create table if not exists dismissed_suggestions (
  id             uuid primary key default gen_random_uuid(),
  type           text not null,
  reference_id   uuid not null,
  period_yyyymm  text not null,
  dismissed_at   timestamptz not null default now(),
  constraint dismissed_suggestions_unique
    unique (type, reference_id, period_yyyymm)
);

alter table dismissed_suggestions drop constraint if exists dismissed_suggestions_type_check;
alter table dismissed_suggestions add constraint dismissed_suggestions_type_check
  check (type in ('income_retainer', 'mileage_shoot', 'expense_template'));

alter table dismissed_suggestions drop constraint if exists dismissed_suggestions_period_yyyymm_check;
alter table dismissed_suggestions add constraint dismissed_suggestions_period_yyyymm_check
  check (period_yyyymm ~ '^\d{4}-\d{2}$');

create index if not exists dismissed_suggestions_period_idx
  on dismissed_suggestions (period_yyyymm);

-- ============================================================================
-- STORAGE BUCKET — client-files
--
-- The single private bucket backing the `files` table. No RLS, no public
-- access: reads and writes go through signed URLs minted server-side by the
-- service-role client (see lib/storage.ts).
--
-- NOTE: `storage.buckets` is owned by the storage schema. Run this from the
-- Supabase SQL Editor, which executes as the `postgres` role and can insert
-- here. A restricted migration runner / non-superuser role may lack INSERT on
-- storage.buckets — if so, grant the privilege or run this statement as
-- `postgres`. The bucket may also be created once via the Supabase dashboard;
-- the ON CONFLICT clause makes this a no-op in that case.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do nothing;

-- ============================================================================
-- SEED — app_settings singleton
--
-- Config, not data: the app_settings table must always have exactly one row.
-- Idempotent — the WHERE NOT EXISTS guard makes a re-run a no-op. (Data seeds
-- live in seed.sql / seed-financials.sql and are run separately.)
-- ============================================================================
insert into app_settings (singleton, home_address, mileage_rate_per_mile, tax_set_aside_percent)
select true, '', 0.70, 28
where not exists (select 1 from app_settings);

-- ============================================================================
-- ROW-LEVEL SECURITY
--
-- RLS is enabled — with NO policies — on the 11 tables below: the 9 client-facing
-- tables plus the 2 owner-only tasks/timer tables (todos, active_timer).
-- With no policy present, RLS is fail-closed: any role WITHOUT the BYPASSRLS
-- attribute sees zero rows. The app accesses these tables exclusively through
-- the Supabase service-role key, which HAS BYPASSRLS, so this is behaviorally
-- inert today — it is a defense-in-depth margin against a stray anon /
-- authenticated connection, and it matches the live database exactly.
--
-- The other 6 tables (time_blocks, app_settings, income_payments,
-- mileage_logs, recurring_expense_templates, dismissed_suggestions) are
-- intentionally left WITHOUT RLS, also matching live.
--
-- `enable row level security` is idempotent, so a re-run is a safe no-op and
-- no guard is needed.
-- ============================================================================
alter table clients   enable row level security;
alter table packages  enable row level security;
alter table projects  enable row level security;
alter table shoots    enable row level security;
alter table time_logs enable row level security;
alter table invoices  enable row level security;
alter table expenses  enable row level security;
alter table messages  enable row level security;
alter table files     enable row level security;
alter table todos        enable row level security;
alter table active_timer enable row level security;
