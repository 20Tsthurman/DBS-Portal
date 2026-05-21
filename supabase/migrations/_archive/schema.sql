-- Digital Bloom Socials — Portal Schema
-- Run this in the Supabase SQL editor.
-- Phase 1 ships the schema; RLS policies are added in a later phase.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- clients
--
-- NEVER HARD-DELETE A CLIENT ROW. The FKs below cascade-delete projects,
-- shoots, time_logs, invoices, messages, and files when a client is removed —
-- losing time_logs is a real tax-audit risk for a service business that bills
-- by the hour. The cascades are kept for schema-cleanliness but the app
-- enforces a SOFT-DELETE-ONLY contract:
--
--   * DELETE /api/clients/[id]  → updates status to 'inactive' + bans the
--     Clerk user. Never issues a SQL DELETE against clients.
--   * deactivateClientAction (app/owner/clients/_actions.ts) is the only
--     UI-facing entry point and mirrors the same logic.
--   * The /owner/clients edit form intentionally omits 'inactive' from its
--     status dropdown; deactivation lives behind a dedicated button so the
--     gravity of the action is visible.
--
-- If you are adding a new mutation surface, NEVER call
-- `.from("clients").delete()`. Update status to 'inactive' instead.
-- ---------------------------------------------------------------------------
create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null unique,
  clerk_user_id   text unique,
  type            text not null check (type in ('brand', 'bride')),
  status          text not null check (status in ('active', 'onboarding', 'inactive', 'lead')) default 'onboarding',
  created_at      timestamptz not null default now(),
  -- Reject empty-string clerk_user_id (NULL is fine; an empty string
  -- would silently break IS NULL queries and the unique constraint).
  constraint clerk_user_id_not_empty check (clerk_user_id is null or length(clerk_user_id) > 0)
);

-- Messages feature: notification throttling. Two independent systems
-- per recipient, each with its own 24-hour cooldown:
--   *_last_new_msg_email_at  — stamped by POST /api/messages
--   *_last_reminder_email_at — stamped by the daily reminder cron
-- Worst case is two emails per 24h per thread per recipient.
alter table clients add column if not exists owner_last_notified_at timestamptz;
alter table clients add column if not exists client_last_notified_at timestamptz;

-- One-shot migration: rename the original notification columns to scope
-- them to the new-message email system (the reminder cron uses its own
-- *_last_reminder_email_at columns added below). NOT idempotent — run
-- once via Supabase SQL editor.
alter table clients rename column owner_last_notified_at to owner_last_new_msg_email_at;
alter table clients rename column client_last_notified_at to client_last_new_msg_email_at;

-- Independent cooldown for the daily reminder cron — see docs §6.5.
alter table clients add column if not exists owner_last_reminder_email_at timestamptz;
alter table clients add column if not exists client_last_reminder_email_at timestamptz;

-- ---------------------------------------------------------------------------
-- packages
-- ---------------------------------------------------------------------------
create table if not exists packages (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  tier               text not null check (tier in ('starter', 'growth', 'premium')),
  monthly_hours      numeric not null,
  monthly_price      numeric not null,
  deliverables_list  text[] not null default '{}',
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  package_id      uuid references packages(id) on delete set null,
  start_date      date,
  current_phase   text not null check (current_phase in ('onboarding', 'strategy', 'content', 'reporting')) default 'onboarding',
  notes           text,
  status          text not null check (status in ('active', 'paused', 'completed')) default 'active',
  created_at      timestamptz not null default now()
);

create index if not exists projects_client_id_idx on projects (client_id);

-- ---------------------------------------------------------------------------
-- shoots
-- ---------------------------------------------------------------------------
create table if not exists shoots (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  project_id       uuid references projects(id) on delete set null,
  scheduled_at     timestamptz not null,
  location         text,
  duration_hours   numeric,
  status           text not null check (status in ('requested', 'confirmed', 'completed', 'cancelled')) default 'requested',
  notes            text,
  -- 'shoot' = a content shoot / filming day; 'meeting' = a Zoom / phone /
  -- in-person meeting Kelsey schedules with a client. Clients can only
  -- request shoots (client booking action hard-codes kind='shoot'); only
  -- the owner-side form lets Kelsey pick.
  kind             text not null default 'shoot'
                     check (kind in ('shoot', 'meeting')),
  -- Only meaningful (and only allowed) when kind = 'meeting'.
  meeting_type     text
                     check (meeting_type is null
                            or meeting_type in ('zoom', 'phone', 'in_person')),
  created_at       timestamptz not null default now(),
  constraint shoots_meeting_type_only_for_meetings
    check ((kind = 'meeting') or (meeting_type is null))
);

create index if not exists shoots_client_id_idx on shoots (client_id);
create index if not exists shoots_scheduled_at_idx on shoots (scheduled_at);

-- ---------------------------------------------------------------------------
-- time_logs
-- ---------------------------------------------------------------------------
create table if not exists time_logs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  logged_by   text not null,
  date        date not null,
  hours       numeric not null,
  category    text not null check (category in ('editing', 'planning', 'filming', 'admin', 'communication')),
  notes       text,
  created_at  timestamptz not null default now()
);

create index if not exists time_logs_client_id_idx on time_logs (client_id);
create index if not exists time_logs_date_idx on time_logs (date);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table if not exists invoices (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients(id) on delete cascade,
  amount                numeric not null,
  due_date              date,
  paid_at               timestamptz,
  status                text not null check (status in ('draft', 'sent', 'paid', 'overdue')) default 'draft',
  stripe_payment_link   text,
  line_items            jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists invoices_client_id_idx on invoices (client_id);
create index if not exists invoices_status_idx on invoices (status);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
create table if not exists expenses (
  id           uuid primary key default gen_random_uuid(),
  category     text not null check (category in ('equipment', 'software', 'travel', 'marketing', 'meals', 'other')),
  description  text,
  amount       numeric not null,
  date         date not null,
  receipt_url  text,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists expenses_date_idx on expenses (date);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  sender_role  text not null check (sender_role in ('owner', 'client')),
  body         text not null,
  sent_at      timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists messages_client_id_idx on messages (client_id);
create index if not exists messages_sent_at_idx on messages (sent_at);

-- ---------------------------------------------------------------------------
-- files
-- ---------------------------------------------------------------------------
create table if not exists files (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null,
  file_url      text not null,
  file_type     text not null check (file_type in ('content', 'contract', 'invoice', 'other')),
  uploaded_at   timestamptz not null default now(),
  uploaded_by   text not null
);

create index if not exists files_client_id_idx on files (client_id);

-- ---------------------------------------------------------------------------
-- time_blocks
--
-- One row = one fixed-time event on Kelsey's calendar that isn't a shoot:
-- a sonography shift, a manually-placed work block (editing/planning), or
-- a personal "blocked" window. All times are wall-clock in PORTAL_TIMEZONE
-- (America/Chicago) — see app/owner/calendar/_lib/timezone.ts. There is no
-- "all-day" mode: the form auto-fills 07:00–21:00 when the user wants one.
--
-- Note: working-hours (07:00–21:00) is deliberately NOT a CHECK constraint
-- here. It is a client-booking rule, enforced in the week grid render and
-- in the client-booking validator. Sonography shifts realistically span
-- outside that window.
-- ---------------------------------------------------------------------------
create table if not exists time_blocks (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  category    text not null check (category in ('sonography', 'work_block', 'blocked')),
  -- Only set when category = 'work_block'. Optional — a general "editing
  -- time" work block with no client attached is allowed.
  client_id   uuid references clients(id) on delete set null,
  label       text,
  notes       text,
  created_at  timestamptz not null default now(),
  constraint time_blocks_times_consistent
    check (end_time > start_time),
  constraint time_blocks_client_only_for_work
    check ((category = 'work_block') or (client_id is null))
);

create index if not exists time_blocks_date_idx on time_blocks (date);
create index if not exists time_blocks_client_id_idx
  on time_blocks (client_id) where client_id is not null;

-- ---------------------------------------------------------------------------
-- app_settings — single-row owner config (Phase 1 Financials).
-- The `singleton` column + unique constraint enforces that only one row
-- can exist. Always read via a `limit 1` / `maybeSingle()` after seed.
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  id                     uuid primary key default gen_random_uuid(),
  singleton              boolean not null default true,
  home_address           text not null default '',
  mileage_rate_per_mile  numeric not null default 0.70
                           check (mileage_rate_per_mile >= 0),
  tax_set_aside_percent  numeric not null default 28
                           check (tax_set_aside_percent >= 0
                                  and tax_set_aside_percent <= 100),
  updated_at             timestamptz not null default now(),
  constraint app_settings_singleton_unique unique (singleton)
);

-- ---------------------------------------------------------------------------
-- income_payments — money received. Distinct from `invoices` (which tracks
-- billing status). `client_name_snapshot` is captured at write time so the
-- row survives a client deletion and works for pre-client backfill.
-- ---------------------------------------------------------------------------
create table if not exists income_payments (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid references clients(id) on delete set null,
  client_name_snapshot  text not null,
  payment_date          date not null,
  amount                numeric not null check (amount > 0),
  income_type           text not null check (income_type in (
                          'brand_retainer', 'wedding_same_day',
                          'one_off_shoot', 'other'
                        )),
  payment_method        text,
  notes                 text,
  logged_by             text not null,
  created_at            timestamptz not null default now()
);

create index if not exists income_payments_payment_date_idx
  on income_payments (payment_date);
create index if not exists income_payments_client_id_idx
  on income_payments (client_id);
create index if not exists income_payments_income_type_idx
  on income_payments (income_type);

-- ---------------------------------------------------------------------------
-- mileage_logs — raw mileage entries. The deduction is computed at read time
-- as `miles * rate_per_mile`; `rate_per_mile` is a snapshot of
-- `app_settings.mileage_rate_per_mile` at the moment of logging so historical
-- entries don't shift when the IRS rate changes.
-- ---------------------------------------------------------------------------
create table if not exists mileage_logs (
  id              uuid primary key default gen_random_uuid(),
  trip_date       date not null,
  from_address    text not null,
  to_address      text not null,
  start_odometer  numeric check (start_odometer is null or start_odometer >= 0),
  end_odometer    numeric check (end_odometer is null or end_odometer >= 0),
  miles           numeric not null check (miles > 0),
  rate_per_mile   numeric not null check (rate_per_mile >= 0),
  client_id       uuid references clients(id) on delete set null,
  notes           text,
  logged_by       text not null,
  created_at      timestamptz not null default now()
);

create index if not exists mileage_logs_trip_date_idx on mileage_logs (trip_date);
create index if not exists mileage_logs_client_id_idx on mileage_logs (client_id);

-- ---------------------------------------------------------------------------
-- recurring_expense_templates — monthly subscriptions / recurring costs.
-- Each active template surfaces a per-month suggestion row in /owner/financials
-- on `day_of_month`; accepting it inserts a matching `expenses` row.
-- ---------------------------------------------------------------------------
create table if not exists recurring_expense_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null check (category in (
                  'platform_software', 'marketing_advertising', 'equipment_gear',
                  'travel_transportation', 'professional_services', 'business_operations'
                )),
  amount        numeric not null check (amount > 0),
  day_of_month  smallint not null default 1 check (day_of_month between 1 and 28),
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists recurring_expense_templates_active_idx
  on recurring_expense_templates (active);

-- ---------------------------------------------------------------------------
-- Alignment block — idempotent ALTERs to bring an already-deployed instance
-- in line with the CREATE TABLE blocks above. Safe to re-run.
-- ---------------------------------------------------------------------------

-- 1. Backfill created_at on tables that originally shipped without it.
alter table packages add column if not exists created_at timestamptz not null default now();
alter table projects add column if not exists created_at timestamptz not null default now();
alter table shoots   add column if not exists created_at timestamptz not null default now();

-- 2. shoots.status: migrate old 3-state values to the new 4-state vocabulary
--    BEFORE swapping the CHECK constraint, or the new constraint will fail.
update shoots set status = 'confirmed' where status = 'scheduled';

alter table shoots drop constraint if exists shoots_status_check;
alter table shoots add  constraint shoots_status_check
  check (status in ('requested', 'confirmed', 'completed', 'cancelled'));
alter table shoots alter column status set default 'requested';

-- 3. expenses.category: enforce the blueprint enum.
--    NOTE: this ALTER will FAIL if any existing row has a category not in the
--    allowed set. If you have data, run the SELECT below first to check.
--    select distinct category from expenses
--      where category not in ('equipment','software','travel','marketing','meals','other');
alter table expenses drop constraint if exists expenses_category_check;
alter table expenses add  constraint expenses_category_check
  check (category in ('equipment', 'software', 'travel', 'marketing', 'meals', 'other'));

-- 4. Drop the legacy availability_blocks table. Replaced by time_blocks in
--    the calendar rebuild. Pre-launch decision: existing rows are not
--    migrated. Re-run-safe; if the table doesn't exist (fresh install),
--    this is a no-op.
drop table if exists availability_blocks;

-- 5. shoots.kind + shoots.meeting_type — added to support Kelsey scheduling
--    meetings (zoom / phone / in_person) alongside content shoots. The
--    `default 'shoot'` on `kind` backfills every existing row automatically.
alter table shoots
  add column if not exists kind text not null default 'shoot';
alter table shoots
  add column if not exists meeting_type text;

alter table shoots drop constraint if exists shoots_kind_check;
alter table shoots add  constraint shoots_kind_check
  check (kind in ('shoot', 'meeting'));

alter table shoots drop constraint if exists shoots_meeting_type_check;
alter table shoots add  constraint shoots_meeting_type_check
  check (meeting_type is null or meeting_type in ('zoom', 'phone', 'in_person'));

alter table shoots drop constraint if exists shoots_meeting_type_only_for_meetings;
alter table shoots add  constraint shoots_meeting_type_only_for_meetings
  check ((kind = 'meeting') or (meeting_type is null));

-- ============================================================================
-- Phase 1 Financials — expenses category enum swap.
--
-- The original six categories ('equipment','software','travel','marketing',
-- 'meals','other') are replaced with Kelsey's six real categories. The audit
-- confirmed no app code path writes to `expenses` and no seed inserts exist,
-- so a drop-and-re-add is safe in this repo. The CREATE TABLE block above is
-- left at the original values intentionally — it only runs on greenfield init
-- and the alignment block is what runs on the live DB (existing precedent).
--
-- WARNING: This ALTER will fail if any row in `expenses` holds a category
-- outside the new list. Before applying, run:
--   select category, count(*) from expenses
--   where category not in (
--     'platform_software','marketing_advertising','equipment_gear',
--     'travel_transportation','professional_services','business_operations'
--   ) group by category;
-- If any rows return, decide on remap or delete BEFORE running the swap.
-- ============================================================================
alter table expenses drop constraint if exists expenses_category_check;
alter table expenses add  constraint expenses_category_check
  check (category in (
    'platform_software', 'marketing_advertising', 'equipment_gear',
    'travel_transportation', 'professional_services', 'business_operations'
  ));

-- Seed the app_settings singleton row if not already present.
insert into app_settings (singleton, home_address, mileage_rate_per_mile, tax_set_aside_percent)
select true, '', 0.70, 28
where not exists (select 1 from app_settings);
