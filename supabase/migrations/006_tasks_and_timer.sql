-- 006_tasks_and_timer.sql
-- Tasks + integrated persistent timer (owner-only).
-- See docs/tasks-and-timer-feature.md §3 for the data model.
--
-- PURELY ADDITIVE: two new tables (todos, active_timer) plus one provenance
-- column on time_logs (source_todo_id). No DROP, no destructive ALTER, no
-- data writes. Safe to run top-to-bottom in the Supabase SQL Editor.
--
-- Conventions match 001_initial_schema.sql: text + CHECK (no PG enums), FKs
-- inline, CHECKs as separate named constraints, singleton via UNIQUE(singleton),
-- RLS enabled with NO policies (service-role-only), idempotent guards throughout.

-- ----------------------------------------------------------------------------
-- todos — owner task list. Optional client_id ties a task to a client (and is
-- what makes the Start-timer button available). category mirrors
-- time_logs.category exactly so it maps 1:1 on auto-log. status + completed_at:
-- app sets completed_at = now() when flipping to 'done', nulls it on un-complete.
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
-- enforces at most one running timer at a time. todo_id CASCADE: deleting the
-- underlying task clears the timer row. client_id / category are SNAPSHOTS
-- captured at Start so the auto-log stays correct even if the task is edited
-- mid-run. No row = nothing running; elapsed = now() − started_at.
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
-- time_logs.source_todo_id — provenance, matching the source_shoot_id /
-- source_template_id pattern. Lets a task sum its logged time, and lets logs
-- survive task deletion (SET NULL rather than cascade).
-- ----------------------------------------------------------------------------
alter table time_logs add column if not exists source_todo_id
  uuid references todos(id) on delete set null;

create index if not exists time_logs_source_todo_id_idx
  on time_logs (source_todo_id) where source_todo_id is not null;

-- ----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY — enabled, NO policies (service-role-only, fail-closed),
-- matching every other table. `enable row level security` is idempotent, so a
-- re-run is a safe no-op and no guard is needed.
-- ----------------------------------------------------------------------------
alter table todos        enable row level security;
alter table active_timer enable row level security;
