-- Digital Bloom Socials — Portal Schema
-- Run this in the Supabase SQL editor.
-- Phase 1 ships the schema; RLS policies are added in a later phase.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- clients
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
  created_at       timestamptz not null default now()
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
-- availability_blocks
-- ---------------------------------------------------------------------------
create table if not exists availability_blocks (
  id                  uuid primary key default gen_random_uuid(),
  -- One-off:    date is set,   recurring_weekday is null.
  -- Recurring:  date is null,  recurring_weekday is set (0=Sunday … 6=Saturday).
  date                date,
  recurring_weekday   smallint,
  -- All-day:    start_time and end_time are both null.
  -- Time-range: both set, end > start.
  start_time          time,
  end_time            time,
  is_blocked          boolean not null default true,
  label               text,
  created_at          timestamptz not null default now(),
  constraint availability_blocks_weekday_range
    check (recurring_weekday is null or recurring_weekday between 0 and 6),
  constraint availability_blocks_date_or_recurring
    check (
      (date is not null and recurring_weekday is null) or
      (date is null and recurring_weekday is not null)
    ),
  constraint availability_blocks_times_consistent
    check (
      (start_time is null and end_time is null) or
      (start_time is not null and end_time is not null and end_time > start_time)
    )
);

create index if not exists availability_blocks_date_idx on availability_blocks (date);

-- ---------------------------------------------------------------------------
-- Alignment block — idempotent ALTERs to bring an already-deployed instance
-- in line with the CREATE TABLE blocks above. Safe to re-run.
-- ---------------------------------------------------------------------------

-- 1. Backfill created_at on tables that originally shipped without it.
alter table packages            add column if not exists created_at timestamptz not null default now();
alter table projects            add column if not exists created_at timestamptz not null default now();
alter table shoots              add column if not exists created_at timestamptz not null default now();
alter table availability_blocks add column if not exists created_at timestamptz not null default now();

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

-- 4. availability_blocks: extend to support recurring weekly blocks and
--    all-day blocks. Existing one-off, time-range rows satisfy the new
--    constraints unchanged, so no data backfill is needed.
alter table availability_blocks add column if not exists recurring_weekday smallint;
alter table availability_blocks alter column date       drop not null;
alter table availability_blocks alter column start_time drop not null;
alter table availability_blocks alter column end_time   drop not null;

alter table availability_blocks
  drop constraint if exists availability_blocks_weekday_range;
alter table availability_blocks
  add  constraint availability_blocks_weekday_range
  check (recurring_weekday is null or recurring_weekday between 0 and 6);

alter table availability_blocks
  drop constraint if exists availability_blocks_date_or_recurring;
alter table availability_blocks
  add  constraint availability_blocks_date_or_recurring
  check (
    (date is not null and recurring_weekday is null) or
    (date is null and recurring_weekday is not null)
  );

alter table availability_blocks
  drop constraint if exists availability_blocks_times_consistent;
alter table availability_blocks
  add  constraint availability_blocks_times_consistent
  check (
    (start_time is null and end_time is null) or
    (start_time is not null and end_time is not null and end_time > start_time)
  );
