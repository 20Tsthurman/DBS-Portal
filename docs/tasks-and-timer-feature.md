# DBS Portal — Tasks + Integrated Timer
**Feature Spec | Owner-side**
*Version 1.0 — June 2026*

> Companion to `docs/dbs-portal-blueprint-v1.md`. This spec is the source of truth for the Tasks feature and the persistent timer. Read this before building anything in `app/owner/tasks/*`.

---

## 1. Purpose

Give Kelsey a single place to plan her work that feeds the rest of the system instead of sitting beside it. The feature collapses three disconnected chores — *plan → do → log* — into one flow:

> **Plan** (add a task, optionally tied to a client) → **Do** (Start a timer on it) → **Log** (time auto-records against that client on Stop) → **Done** (check it off).

This also delivers the **persistent active timer** the blueprint specified but was never built. The timer lives in the owner top bar, follows Kelsey across every page, and is the reason this feature is worth building over a generic checklist.

**Owner-only.** Clients never see tasks or the timer.

---

## 2. Locked Decisions

| # | Decision | Choice | Reason |
|---|---|---|---|
| 1 | Timer persistence | **DB-backed** single `active_timer` row; elapsed = `now − started_at` | Survives refresh, navigation, tab close, device switch. localStorage is device-bound and fragile. |
| 2 | Duration authority | **Server** computes duration on Stop from `started_at` → server `now()` | No clock drift, no client-trust issue. Client tick is display-only. |
| 3 | One timer at a time | Single active timer (singleton row). Starting a new one **auto-stops + logs** the running one first. | Single-owner model; mirrors `app_settings` singleton pattern. |
| 4 | Timer requires a client | Start is only offered on tasks **with a `client_id`**. Clientless tasks are checklist-only (no Start button). | A time log needs a client to attach to. |
| 5 | Auto-log target | On Stop, insert a real `time_logs` row (client, category, hours, note, `source_todo_id`) | Reuses existing time tracker; no parallel data store. |
| 6 | Category source | Pulled from the task's optional `category`; defaults to `admin` if unset | Keeps logging frictionless; editable later in Time tracker. |
| 7 | Task grouping | By **due bucket** (Overdue → Today → This week → Later → Completed), not by client | "What's on fire" is the question Kelsey opens this to answer. |
| 8 | Scope of v1 | Tasks CRUD + client tag + due date + the timer + a dashboard "tasks due" flag | Tight, shippable. Recurring tasks, priority, manual reorder, calendar markers are **out** (see §8). |
| 9 | Security posture | Owner-only; `requireOwner()` / `requireOwnerApi()` on everything. RLS **enabled, no policies** (service-role-only), matching existing tables | Consistent with current DB posture — do NOT add CREATE POLICY. |

---

## 3. Data Model

Conventions match the existing schema: **text + CHECK** (no native PG enums), no triggers/stored functions, derived values written by app code, provenance via `source_*` columns, singletons via `UNIQUE(singleton)`.

### 3.1 New table — `todos`

```
todos
  id            uuid pk default gen_random_uuid()
  title         text not null
  client_id     uuid null  FK → clients(id) ON DELETE SET NULL
  category      text null   CHECK (category IN ('editing','planning','filming','admin','communication'))
  due_date      date null
  status        text not null default 'open'  CHECK (status IN ('open','done'))
  completed_at  timestamptz null
  created_at    timestamptz not null default now()
```

- `category` mirrors `time_logs.category` exactly (same five values) so it maps 1:1 on auto-log.
- `due_date` nullable → task lands in the "Later / No date" bucket.
- `status` + `completed_at`: app sets `completed_at = now()` when flipping to `done`, nulls it on un-complete.

### 3.2 New table — `active_timer` (singleton, 0 or 1 row)

```
active_timer
  id          uuid pk default gen_random_uuid()
  singleton   boolean not null default true  UNIQUE
  todo_id     uuid not null  FK → todos(id) ON DELETE CASCADE
  client_id   uuid null      FK → clients(id) ON DELETE SET NULL
  category    text null      CHECK (category IN ('editing','planning','filming','admin','communication'))
  started_at  timestamptz not null default now()
  created_at  timestamptz not null default now()
```

- `UNIQUE(singleton)` enforces at most one running timer.
- `todo_id` CASCADE: if the underlying task is deleted while running, the timer row disappears too.
- `client_id` / `category` are **snapshots** captured at Start, so the log is correct even if the task is edited mid-run.
- No row = no timer running. The top-bar pill reads this row on every load.

### 3.3 Column add — `time_logs.source_todo_id`

```
ALTER TABLE time_logs
  ADD COLUMN source_todo_id uuid null FK → todos(id) ON DELETE SET NULL;
```

- Provenance, matching the `source_shoot_id` / `source_template_id` pattern.
- Lets the task row display "Logged Xm" by summing its logs, and lets logs survive task deletion.

### 3.4 Migration

- File: `supabase/migrations/006_tasks_and_timer.sql`
- Contents: create `todos`, create `active_timer`, alter `time_logs`, then `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on both new tables (**no CREATE POLICY** — service-role-only, matching existing posture).
- **Must be run manually in the Supabase SQL Editor.** Claude Code edits `schema.sql` but cannot execute SQL against the live DB.

---

## 4. Behavior & Flows

### 4.1 Task list (`/owner/tasks`)
- Header + "Add task" → slide-in form (match existing Add-Client slide-in styling): title (required), client (optional select), category (optional select, same 5 values), due date (optional).
- Grouped by due bucket; Completed group collapsed/last.
- Each row: checkbox, title, client tag (mauve badge `Client · Category`), due label (red if overdue, amber if today), "Logged Xm" if logs exist, and a **Start** button (client tasks only) or a quiet "no client" marker.

### 4.2 Start
1. If a timer is already running, **stop + log it first** (silent), then proceed.
2. Insert `active_timer` row with `todo_id`, snapshot `client_id` + `category`, `started_at = now()`.
3. Top-bar pill appears and ticks (client-side, from `started_at`).
4. `revalidatePath` so the task row shows its live "Tracking" state.

### 4.3 Stop (from pill or task row)
1. Read `active_timer`, compute `seconds = serverNow − started_at`.
2. Insert `time_logs`: `client_id`, `logged_by = owner`, `date = today`, `hours = round(seconds/3600, 2)`, `category = active_timer.category ?? 'admin'`, `notes = "Task: <title>"`, `source_todo_id`.
3. Delete the `active_timer` row.
4. `revalidatePath('/owner/tasks')` and the time tracker path. Toast: "Logged Xm to {Client} — {Category} · added to Time tracker."

### 4.4 Complete a task
- If a timer is running on it, **stop + log first**, then set `status='done'`, `completed_at=now()`. Un-complete reverses status + nulls `completed_at` (does not touch logs).

### 4.5 Persistence
- On any page load, the top-bar timer component reads `active_timer`; if present, renders the pill and ticks from `started_at`. No polling needed — the tick is pure client-side arithmetic against a server timestamp.

---

## 5. UI Surfaces

| Surface | What | Where |
|---|---|---|
| Tasks page | The list + add/edit/complete/delete | `app/owner/tasks/` (new) |
| Sidebar nav | "Tasks" item (checklist icon), between Time and Financials | owner sidebar component |
| Top-bar timer pill | Persistent running-timer widget w/ Stop | owner top-bar / shell component (mount once at layout level so it shows on every owner page) |
| Dashboard flag | "Tasks due" widget: Overdue / Due today counts → link to `/owner/tasks` | `app/owner/dashboard/_components/` (fills an empty alert slot) |

> Claude Code: locate the existing owner top-bar/shell component first; the pill must mount there (not per-page) so it persists across navigation.

---

## 6. File Map (anticipated)

```
supabase/migrations/006_tasks_and_timer.sql        (new — run manually)
app/owner/tasks/page.tsx                            (new)
app/owner/tasks/_actions.ts                         (new — requireOwner on every action)
app/owner/tasks/_lib/queries.ts                     (new — list + grouping + logged-time sums)
app/owner/tasks/_components/*                        (new — list, row, add/edit slide-in)
components/.../OwnerTopbar (or shell)               (edit — mount TimerPill)
components/.../TimerPill.tsx                         (new — reads active_timer, ticks, Stop)
lib/timer.ts (or _actions)                          (new — startTimer / stopTimer server actions)
app/owner/dashboard/_components/TasksDueWidget.tsx  (new)
<owner sidebar>                                      (edit — add Tasks nav item)
schema.sql                                           (edit — reflect 006)
```

---

## 7. Edge Cases & Guards

- **One timer only** — enforced by `UNIQUE(singleton)`; Start always stop-logs any existing timer first.
- **Stale/runaway timer** — if `started_at` is more than **8 hours** ago on load, the pill shows a warning state ("Running 9h — Stop to log or discard") rather than silently logging a giant entry. v1: warn + let her Stop (logs real elapsed) — a "discard" option can come later.
- **Task deleted while running** — `active_timer.todo_id` CASCADE removes the timer row; pill clears on next load.
- **Task deleted with logs** — `time_logs.source_todo_id` SET NULL; logs persist in the time tracker.
- **Clientless task** — no Start button; checklist only.
- **Category unset at Stop** — log defaults to `admin`; editable in Time tracker.
- **Hours rounding** — `round(seconds/3600, 2)` (≈36s granularity).

---

## 8. Out of Scope for v1

- **Recurring / auto-generated tasks** (model later like `recurring_expense_templates`)
- **Priority field & manual reordering**
- **Calendar markers** for due dates (dashboard flag covers the "what's due" need for now)
- **Client-side task visibility** (owner-only feature)
- **Ad-hoc timer** not tied to a task (timer always starts from a client task in v1)
- **Discard-timer-without-logging** (v1 always logs real elapsed on Stop)

---

## 9. Build Order

1. **Migration 006** — tables + column + RLS enable. Run manually, verify in SQL Editor. *(stop checkpoint)*
2. **Tasks page (no timer)** — CRUD, client tag, due date, grouping, complete/uncomplete. *(stop checkpoint)*
3. **Timer** — `active_timer` actions, top-bar pill mounted at layout level, Start/Stop, auto-log to `time_logs`, persistence on reload. *(stop checkpoint)*
4. **Dashboard "tasks due" flag** + sidebar nav item. *(stop checkpoint)*

Each phase independently shippable. Typecheck between steps. Use `revalidatePath` (not `router.refresh`).

---