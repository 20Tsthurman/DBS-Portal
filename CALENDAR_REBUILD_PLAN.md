# Calendar Rebuild Plan

Research-phase document. No code changes have been made. Once you sign off on the open
questions at the bottom, Phase 1 (schema migration) can start.

---

## 1. Inventory of the current calendar surface

All files reachable from the calendar entrypoints, plus the parallel client booking
surface. One-liner per file.

### Owner Calendar UI — `app/owner/calendar/_components/`

| File | What it does |
|---|---|
| `MonthGrid.tsx` | 6×7 month grid; renders shoot pills + classifies blocks per cell (top-bar tints for time-range blocked/available, cell-bg tints for all-day). |
| `MonthHeader.tsx` | Prev/next/today month navigation + "Month YYYY" title. |
| `WeekGrid.tsx` | 7-column hour grid (currently 6am–10pm); renders shoots absolutely positioned + striped blocked regions + inverse-striped regions from "available" windows. |
| `WeekHeader.tsx` | Prev/next/this-week navigation + "Mon D – D, YYYY" title. |
| `WeekGridShoot.tsx` | Single shoot pill inside week grid; opens `ShootFormPanel` on click. |
| `ViewToggle.tsx` | Month ↔ Week segmented control in the top toolbar. |
| `DaySidePanel.tsx` | Slide-out panel for a selected day; lists shoots + availability blocks, with "+ Add Shoot" / "+ Block Time" buttons. |
| `AvailabilityBlockFormPanel.tsx` | Slide-out form for create/edit of an availability block; handles isBlocked, isAllDay, recurring vs one-off. |
| `BlockRowActions.tsx` | "···" menu (Edit/Delete) on a block row. |

### Owner Calendar Logic/Data — `app/owner/calendar/_lib/` + actions

| File | What it does |
|---|---|
| `_lib/dateMath.ts` | Pure date math: month grid, week dates, parsing, formatting, weekday labels, `WEEK_GRID_*` constants (currently 6am–10pm), `defaultShootIsoForDay`. |
| `_lib/queries.ts` | `fetchAvailabilityBlocksInRange`, `fetchRecurringAvailabilityBlocks`, `blocksForDate`, `classifyBlocksForDate` (default vs available mode), `inverseAvailabilityWindows`. |
| `_actions.ts` | `createAvailabilityBlock`, `updateAvailabilityBlock`, `deleteAvailabilityBlock`. Gated by `ensureOwner()`. |

### Owner Calendar — Recurring subdirectory

| File | What it does |
|---|---|
| `recurring/page.tsx` | 7-column page grouping every recurring block by weekday. |
| `recurring/_components/RecurringColumn.tsx` | Single weekday column; lists recurring blocks + "+ Add Block" trigger that opens the shared `AvailabilityBlockFormPanel` in recurring mode. |

### Client Booking UI — `app/client/book/`

| File | What it does |
|---|---|
| `page.tsx` | Client's month view of their own shoots overlaid on Kelsey's availability. |
| `_components/ClientMonthGrid.tsx` | Near-clone of owner `MonthGrid.tsx`. Renders the client's shoots (anonymized as "Your shoot") + same block tinting; past days are non-clickable. |
| `_components/ClientMonthHeader.tsx` | Near-clone of owner `MonthHeader.tsx`, links pointing at `/client/book` instead. |
| `_components/ClientDaySidePanel.tsx` | Slide-out for a selected day; warning text if blocks present + "+ Request a Shoot" + list of client's existing shoots with cancel. |
| `_components/RequestShootFormPanel.tsx` | Request form with morning/afternoon/evening/specific time-of-day buckets; ISO is built client-side. |
| `_lib/queries.ts` | `fetchMyShootsInRange`, `fetchMyUpcomingShoots`, `fetchAvailabilityBlocksForClient`. |
| `_actions.ts` | `requestShoot` (creates `requested` shoot), `cancelMyShootRequest` (only on `requested` rows). |

### Shoot Module — `app/owner/shoots/` (NOT being rebuilt)

| File | What it does |
|---|---|
| `page.tsx` | Two-section "Upcoming / Past" shoots list. |
| `_actions.ts` | `createShoot`, `updateShoot`, `confirmShoot`, `cancelShoot`, `completeShoot`, `deleteShoot`. |
| `_lib/queries.ts` | `fetchUpcomingShoots`, `fetchPastShoots`, `fetchShootsInRange`, `ShootWithClientName` type. |
| `_lib/format.ts` | `shootStatusLabel`, `shootStatusTone`. |
| `_components/AddShootButton.tsx` | Toolbar button that opens `ShootFormPanel`. |
| `_components/ShootFormPanel.tsx` | Create/edit slide-out form. |
| `_components/ShootRowActions.tsx` | Confirm/Complete/Cancel/Edit/Delete menu. |

### Shared Types — `lib/`

| File | What it does |
|---|---|
| `lib/supabase.ts` | Supabase client factories + every row type: `ShootRecord`, `ShootStatus`, `AvailabilityBlockRecord`, `ClientRecord`, etc. |
| `lib/currentClient.ts` | `getCurrentClient` / `requireCurrentClient` — resolve signed-in Clerk user to a `clients` row. |

### External references (things that import from the above)

- `app/client/layout.tsx` — sidebar item `"Book a Shoot" → /client/book`. The route stays; the page rebuilds.
- `docs/features/scheduling.md` and `dbs-portal-blueprint-v1.md` — docs only; updated post-rebuild.
- **No other module** (dashboard, clients, shoots list, time logs, messages) reads `availability_blocks` or any of the calendar helpers. Confirmed via grep.

---

## 2. Current database schema

From `supabase/schema.sql`. There are no RLS policies, triggers, functions, or views on
any calendar-related tables.

### `availability_blocks` (current shape)

```sql
create table availability_blocks (
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
create index availability_blocks_date_idx on availability_blocks (date);
```

### `shoots` (current shape — staying as-is)

```sql
create table shoots (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  project_id       uuid references projects(id) on delete set null,
  scheduled_at     timestamptz not null,
  location         text,
  duration_hours   numeric,
  status           text not null check (status in ('requested','confirmed','completed','cancelled')) default 'requested',
  notes            text,
  created_at       timestamptz not null default now()
);
create index shoots_client_id_idx on shoots (client_id);
create index shoots_scheduled_at_idx on shoots (scheduled_at);
```

### Other tables touched by calendar code

None. The calendar reads `clients(id, name)` only via the shoots query's `attachClientNames`
helper — there's no calendar-specific dependency on `clients`, `projects`, `packages`, or
`time_logs`.

---

## 3. DELETE / KEEP / CHANGE

### DELETE

Whole files/directories to remove:

- `app/owner/calendar/recurring/` (entire subdirectory: `page.tsx`, `_components/RecurringColumn.tsx`).
- `app/client/book/_components/ClientMonthGrid.tsx`
- `app/client/book/_components/ClientMonthHeader.tsx`
- `app/client/book/_components/ClientDaySidePanel.tsx`
- `app/client/book/_lib/queries.ts` (specifically `fetchAvailabilityBlocksForClient`, plus the others get rewritten — but the file's better as a fresh write than an edit, see Phase 5).
- `app/owner/calendar/_components/MonthGrid.tsx`, `WeekGrid.tsx`, `WeekGridShoot.tsx`, `DaySidePanel.tsx`, `AvailabilityBlockFormPanel.tsx`, `BlockRowActions.tsx` — all replaced.
- The `Recurring Hours` toolbar `<Link>` in `page.tsx` (lines 94–111 and 188–205).

Specific exports/functions to remove:

- `fetchRecurringAvailabilityBlocks` (queries.ts)
- `inverseAvailabilityWindows` (queries.ts)
- `classifyBlocksForDate` (queries.ts) — replaced by a simpler `blocksForDate` since "available mode" is gone.
- `AvailabilityBlockRecord.recurring_weekday` and `.is_blocked` (lib/supabase.ts)
- `CreateBlockInput.recurringWeekday` and `.isBlocked` (calendar/_actions.ts) — and the corresponding code paths.
- `UpdateBlockInput.isBlocked` (calendar/_actions.ts).

### KEEP (untouched, or near-untouched)

- `app/owner/calendar/_lib/dateMath.ts` — almost entirely survives. Just need to:
  - Change `WEEK_GRID_START_HOUR = 6` → `7`
  - Change `WEEK_GRID_END_HOUR = 22` → `21`
  - Otherwise unchanged: month grid, week dates, parsing/formatting, `friendlyDate`, `formatTimeRange`, `defaultShootIsoForDay`.
- `shoots` table, `ShootRecord`, `ShootStatus`, `fetchShootsInRange`, `fetchUpcomingShoots`, `fetchPastShoots`, `ShootWithClientName` — the shoot module is not in scope.
- `ensureOwner()` pattern in `_actions.ts` and the auth pattern in `lib/currentClient.ts`.
- `app/owner/shoots/_components/ShootFormPanel.tsx`, `ShootRowActions.tsx`, `AddShootButton.tsx` — reused by the new owner calendar's day panel.
- The "Book a Shoot" sidebar nav entry in `app/client/layout.tsx`.

### CHANGE (existing files rewritten in place)

| File | Change |
|---|---|
| `supabase/schema.sql` | Replace the `availability_blocks` block with new `time_blocks` table (see §4). Add the migration ALTERs at the bottom. |
| `lib/supabase.ts` | Replace `AvailabilityBlockRecord` with `TimeBlockRecord`. Update `Database.public.Tables` key. Add `TimeBlockCategory` enum type. |
| `app/owner/calendar/_lib/dateMath.ts` | Constants only: `WEEK_GRID_START_HOUR = 7`, `WEEK_GRID_END_HOUR = 21`. Everything else stays. |
| `app/owner/calendar/_lib/queries.ts` | Rewrite. New shape: `fetchEventsInRange(start, end) → CalendarEvent[]` that joins shoots + time_blocks. Drop the recurring + available-mode helpers. |
| `app/owner/calendar/_actions.ts` | Rewrite as `createTimeBlock` / `updateTimeBlock` / `deleteTimeBlock`. Add server-side working-hours validation (7am–9pm). |
| `app/owner/calendar/page.tsx` | Rewrite as a three-view (week/month/agenda) router. Remove the Recurring Hours toolbar link. |
| `app/client/book/page.tsx` | Rewrite (different model — see §6 and Phase 5). |
| `app/client/book/_actions.ts` | Add server-side conflict check + override flag to `requestShoot`. |

---

## 4. New database schema

### Recommendation: **two tables — `shoots` (unchanged) + new `time_blocks` (unified for everything else)**

You asked whether to go fully unified, fully separate, or split. Here's my recommendation
and reasoning:

**Keep `shoots` as its own table.** It has client-domain fields (`client_id`, `project_id`,
`status` with the requested→confirmed lifecycle, `duration_hours`) that don't apply to
anything else. Forcing it into an `events` table means either nullable columns everywhere
or a sidecar table — neither is cleaner than what we have.

**Unify the other three (sonography, work blocks, blocked/personal) into one `time_blocks`
table with a `category` enum.** All three share the same shape (`date` + time range + label +
optional `client_id` for work blocks). Three separate tables (`sono_shifts`, `work_blocks`,
`blocked_times`) would be three near-identical schemas with three CRUD action sets and three
fetches per week-view load. The discriminator pattern wins here.

**Table name: `time_blocks`** (not `blocked_times` — too narrow now that this table also
holds sonography shifts and work blocks).

### `time_blocks` — proposed shape

```sql
create table time_blocks (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  -- Both required: working-hours rule means there are no all-day blocks in the new model.
  -- Time blocks always have an explicit start/end inside 07:00–21:00.
  start_time  time not null,
  end_time    time not null,
  category    text not null check (category in ('sonography', 'work_block', 'blocked')),
  -- Only meaningful when category = 'work_block'. Enforced by the check below.
  client_id   uuid references clients(id) on delete set null,
  label       text,
  notes       text,
  created_at  timestamptz not null default now(),
  constraint time_blocks_times_consistent
    check (end_time > start_time),
  constraint time_blocks_working_hours
    check (start_time >= '07:00:00' and end_time <= '21:00:00'),
  constraint time_blocks_client_only_for_work
    check (
      (category = 'work_block') or (client_id is null)
    )
);

create index time_blocks_date_idx on time_blocks (date);
create index time_blocks_client_id_idx on time_blocks (client_id) where client_id is not null;
```

Notes on this shape:

- `category` is intentionally a `text + check` (not a Postgres enum) to match the
  established convention in this schema (`shoots.status`, `clients.type`, `expenses.category`,
  etc.). Easier to evolve.
- `all-day` is gone. The blueprint's "default available, mark exceptions" model + a global
  7am–9pm working window means an "all-day blocked" can be expressed as a 7:00–21:00 block.
  This eliminates an entire class of UI edge case (mixed all-day + time-range rendering).
- `client_id` lets work blocks attribute editing/planning time to a specific client (the
  blueprint's smart-board logic). It only applies to work blocks; the check enforces this.
- `notes` is added for work blocks (e.g., "Editing Sarah's Q2 reels"). Sonography and
  blocked rows can leave it null.
- No `recurring_*` columns. Sonography shifts are entered manually each week as
  one-offs, per the spec.

### Migration SQL

```sql
-- Phase 1 migration: replace availability_blocks with time_blocks.

create table if not exists time_blocks (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  category    text not null check (category in ('sonography', 'work_block', 'blocked')),
  client_id   uuid references clients(id) on delete set null,
  label       text,
  notes       text,
  created_at  timestamptz not null default now(),
  constraint time_blocks_times_consistent
    check (end_time > start_time),
  constraint time_blocks_working_hours
    check (start_time >= '07:00:00' and end_time <= '21:00:00'),
  constraint time_blocks_client_only_for_work
    check ((category = 'work_block') or (client_id is null))
);

create index if not exists time_blocks_date_idx on time_blocks (date);
create index if not exists time_blocks_client_id_idx
  on time_blocks (client_id) where client_id is not null;

-- Drop the old table. Per the open questions below, confirm there are no
-- production rows worth migrating before running this in non-dev.
drop table if exists availability_blocks;
```

If you want to migrate existing one-off, time-range, blocked-only rows from
`availability_blocks` → `time_blocks`, do it before the `drop`:

```sql
insert into time_blocks (date, start_time, end_time, category, label, created_at)
select
  date,
  start_time,
  end_time,
  'blocked',
  label,
  created_at
from availability_blocks
where
  date is not null            -- skip recurring
  and is_blocked = true       -- skip "available" rows
  and start_time is not null  -- skip all-day; or coerce to 07:00–21:00 if you prefer
  and start_time >= '07:00:00'
  and end_time   <= '21:00:00';
```

(See open question #1 — likely fine to just drop everything since this is pre-launch.)

---

## 5. New file / folder structure

```
app/owner/calendar/
  page.tsx                                  # routes to Week / Month / Agenda by ?view=
  _components/
    ViewToggle.tsx                          # KEPT-LIKE: 3-state segmented (Week/Month/Agenda); rebuilt for 3 options
    WeekView.tsx                            # NEW: 7-day hour grid, 7am–9pm, all 4 event types layered
    MonthView.tsx                           # NEW: 6×7 cells, event chips colored by category
    AgendaView.tsx                          # NEW: chronological list, grouped by day, default mobile fallback
    EventChip.tsx                           # NEW: category color + status texture, used by all three views
    DayPanel.tsx                            # RENAMED from DaySidePanel; rebuilt for 4 event types
    ShootFormPanel (re-exported)            # KEPT: imported from app/owner/shoots/_components
    TimeBlockFormPanel.tsx                  # NEW: replaces AvailabilityBlockFormPanel; category-aware form
    TimeBlockRowActions.tsx                 # NEW: replaces BlockRowActions; same edit/delete pattern
    WeekHeader.tsx                          # KEPT, light tweaks (no recurring link)
    MonthHeader.tsx                         # KEPT, light tweaks (no recurring link)
    AgendaHeader.tsx                        # NEW: range picker (default = today + next 14 days)
  _lib/
    dateMath.ts                             # KEPT (constants change to 7/21)
    eventColors.ts                          # NEW: category → color, status → texture mapping
    queries.ts                              # REWRITTEN: fetchEventsInRange returns CalendarEvent[]
    types.ts                                # NEW: CalendarEvent + EventCategory union
    conflicts.ts                            # NEW: overlap detection used by client/_actions.ts
  _actions.ts                               # REWRITTEN: time_blocks CRUD + working-hours guards

app/client/book/
  page.tsx                                  # REWRITTEN: client booking surface (no leak of Kelsey's other events)
  _components/
    ClientBookingCalendar.tsx               # NEW: client-facing month + day picker that hides Kelsey's data
    RequestShootFormPanel.tsx               # REWRITTEN: server-checks conflict, supports "send anyway" path
  _lib/
    queries.ts                              # REWRITTEN: only fetchMyShootsInRange (no availability fetch)
  _actions.ts                               # REWRITTEN: requestShoot adds conflict check + ackConflict flag
```

Net-new vs renamed-from-old:

- **Net-new:** `WeekView`, `MonthView`, `AgendaView`, `EventChip`, `AgendaHeader`,
  `eventColors.ts`, `types.ts`, `conflicts.ts`, `ClientBookingCalendar`.
- **Renamed/rewritten:** `MonthGrid` → `MonthView`, `WeekGrid` → `WeekView`,
  `DaySidePanel` → `DayPanel`, `AvailabilityBlockFormPanel` → `TimeBlockFormPanel`,
  `BlockRowActions` → `TimeBlockRowActions`, all of `app/client/book/_components/*`.
- **Kept ~as-is:** `WeekHeader`, `MonthHeader`, `dateMath.ts` (except constants),
  `ViewToggle` (extended to 3 options).

---

## 6. Data fetching strategy

### The unified consumer type

The whole point of the rewrite is that views don't care which underlying table an event
came from. Define one shape that everything renders against:

```ts
// app/owner/calendar/_lib/types.ts

export type EventCategory =
  | "shoot"
  | "sonography"
  | "work_block"
  | "blocked";

export type EventStatus =
  // Shoots: requested | confirmed | completed | cancelled
  // Time blocks: 'scheduled' (always, no status column on time_blocks)
  | "requested" | "confirmed" | "completed" | "cancelled" | "scheduled";

export interface CalendarEvent {
  id: string;
  category: EventCategory;
  // Local YYYY-MM-DD for the start day. Used for day-bucketing in views.
  dateKey: string;
  // Full timestamp for ordering / week-grid positioning.
  startsAt: Date;
  endsAt: Date;
  title: string;             // "Sarah Reyes" for shoots; label for time_blocks
  subtitle: string | null;   // location (shoots); client name (work_block); null otherwise
  status: EventStatus;
  // Discriminated source — lets row-action menus call the right action.
  source:
    | { kind: "shoot"; shootId: string; clientId: string }
    | { kind: "time_block"; timeBlockId: string; clientId: string | null };
}
```

### How `page.tsx` fetches a week

```ts
// app/owner/calendar/_lib/queries.ts

export async function fetchEventsInRange(
  start: Date,
  end: Date
): Promise<CalendarEvent[]> {
  const supabase = getSupabaseServiceClient();

  const [shootsRes, blocksRes] = await Promise.all([
    supabase
      .from("shoots")
      .select("id, client_id, scheduled_at, duration_hours, location, status")
      .gte("scheduled_at", start.toISOString())
      .lt("scheduled_at", end.toISOString()),
    supabase
      .from("time_blocks")
      .select("id, date, start_time, end_time, category, client_id, label")
      .gte("date", dateKey(start))
      .lt("date", dateKey(end)),
  ]);

  if (shootsRes.error) throw new Error(shootsRes.error.message);
  if (blocksRes.error) throw new Error(blocksRes.error.message);

  // attachClientNames runs once, batched, over the union of all client_ids.
  const shoots = (shootsRes.data ?? []) as ShootRowLite[];
  const blocks = (blocksRes.data ?? []) as TimeBlockRowLite[];
  const clientIds = Array.from(new Set([
    ...shoots.map((s) => s.client_id),
    ...blocks.map((b) => b.client_id).filter((id): id is string => !!id),
  ]));
  const nameById = await fetchClientNames(supabase, clientIds);

  return [
    ...shoots.map((s) => shootToEvent(s, nameById)),
    ...blocks.map((b) => blockToEvent(b, nameById)),
  ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
```

Why this shape:

- Single fetch entrypoint, single sort, one batched name-lookup. Views consume one array.
- View files don't import from `lib/supabase.ts` at all — they only know about
  `CalendarEvent`. Easy to swap source tables later without touching views.
- The `source` discriminator means `DayPanel`'s row-action menu can still call the
  right CRUD action (`updateShoot` vs `updateTimeBlock`) without losing type safety.

### Client booking fetches less

The client surface intentionally **does not fetch any of Kelsey's other events**. It only
needs the client's own shoots:

```ts
// app/client/book/_lib/queries.ts

export async function fetchMyShootsInRange(start: Date, end: Date): Promise<ShootRecord[]>;
```

Conflict detection happens server-side at submit (§7 + Phase 5), not at render.

---

## 7. Risks, unknowns, and decisions you need to make

### 7.1 Migration data — likely fine, but confirm

The current `availability_blocks` table is populated only by manual owner action. If
you've used the recurring page or the "available windows" form in your dev/prod
environment, those rows will not survive the rebuild. Either:

- **(a) Drop everything** — simplest; you re-enter from scratch. Recommended given the
  app is pre-launch.
- **(b) Selectively migrate** — only one-off, time-range, `is_blocked=true` rows that
  already fit within 07:00–21:00, mapping them to `category = 'blocked'`. SQL provided
  in §4.

### 7.2 External callers of `/client/book` and the recurring page

- `/client/book` is only linked from `app/client/layout.tsx`. The route stays; the page
  rebuilds. No other callers.
- `/owner/calendar/recurring` is only linked from `app/owner/calendar/page.tsx`. Those
  toolbar `<Link>`s get removed when `page.tsx` is rewritten. No other callers.

No external dependencies will break.

### 7.3 Shoot module assumes nothing about availability

Confirmed via grep. `app/owner/shoots/*` does not import any availability helpers and the
shoots CRUD does not validate against availability. **This means after the rebuild, the
owner can still create shoots outside 7am–9pm or on top of a sonography shift from the
shoots page.** That's a deliberate "owner can always override" policy — but flagging it so
you decide whether the owner shoot form should also enforce working hours / warn on
conflicts in a later phase.

### 7.4 Work block shape — needs your input

Current proposal (§4):

```sql
time_blocks (date, start_time, end_time, category='work_block', client_id, label, notes)
```

Things to confirm:

- Is `client_id` always required for work blocks, or optional (i.e., "general editing time")?
  Current draft makes it **optional** — `category = 'work_block'` without `client_id` is
  allowed. If you want it required, the check becomes
  `(category = 'work_block' and client_id is not null) or category != 'work_block' and client_id is null`.
- Do you want a `project_id` FK as well, or is `client_id` sufficient granularity?
- Should work blocks roll up into `time_logs` automatically? The current schema has
  `time_logs(client_id, date, hours, category)` — work blocks could be a planning view of
  intent, and `time_logs` records what actually happened. I'd keep them separate.

### 7.5 Sonography shifts — needs your input

These are Kelsey's day job. Things to decide:

- Do they need a `location` field (which hospital)? Default proposal: use the `label`
  field as free text.
- Are they always entered by Kelsey, or might they sync from an external calendar later?
  Affects whether we need an `external_id` / `provider` column. Default proposal: no,
  manual entry only.

### 7.6 7am–9pm working hours — pushback worth considering

Some pushback to chew on, then make the call:

- A hard server-side check on `time_blocks` rejecting `< 07:00` or `> 21:00` is fine for
  blocked/work blocks. But **sonography shifts realistically start before 7am** (hospital
  shifts often start 6:30 or 7:00). Suggest one of:
  - **(a)** Keep the constraint and force Kelsey to round to 07:00 for early shifts (lossy).
  - **(b)** Drop the working-hours `CHECK` from the table, enforce it only in the UI
    (week grid stops at 7/21) and in client-booking validation. Sonography can exceed,
    blocked/work blocks can too if needed — but client requests cannot.
  - **(c)** Keep the constraint for `category in ('blocked', 'work_block')` only,
    excluding `sonography` from it.

  Recommendation: **(b)**. The "global 7–9 working hours" is really a *client-booking*
  constraint, not a *Kelsey-can't-do-anything-outside-this-range* constraint. Enforcing
  in the table makes false-precision look like a hard truth.

### 7.7 Conflict check semantics for client booking

Spec says: server-side at submit; conflicts go through with a "Kelsey has a possible
conflict — send anyway?" confirmation. The implementation needs:

- A `conflicts.ts` helper that takes a proposed `(start, end)` and queries any
  shoots/time_blocks overlapping it.
- A two-step action: `requestShoot` checks for conflicts; if any, returns
  `{ ok: false, error: "conflict", conflicts: [...summaries] }` *without* writing.
- The client form sees that response, asks for confirmation, and re-calls with
  `acknowledgeConflict: true` which skips the check.

Confirm:

- Should the conflict response leak any detail to the client? Spec says no — proposal is
  to return a count + a generic message ("Kelsey has 2 other commitments at this time"),
  not the actual events. That preserves privacy.

### 7.8 Mobile / Agenda

Spec: "Agenda is new and also serves as the mobile fallback." Decide:

- Is the Agenda view *always* a list, with media-query switching at the page level?
  Default proposal: yes, Agenda is its own URL (`?view=agenda`) and is also the auto-fallback
  below some breakpoint (768px). Saves us from rendering Week/Month at all on mobile.

---

## 8. Sequenced implementation plan

Each phase is meant to ship as a discrete PR. Complexity is calibrated to "what could go
wrong" rather than "lines changed."

### Phase 1 — Schema migration (LOW complexity, separate PR)

- Decide on §7.1, §7.4, §7.5, §7.6 first.
- Write the migration SQL in `supabase/schema.sql` (replace `availability_blocks` block
  with `time_blocks`, append idempotent ALTERs in the alignment section).
- Run in the Supabase SQL editor.
- Update `lib/supabase.ts`: drop `AvailabilityBlockRecord`, add `TimeBlockRecord` +
  `TimeBlockCategory`. Update `Database.public.Tables`.
- The app is broken between this PR and Phase 2 (TS errors everywhere). Phases 1+2 can
  be merged together if you want to avoid that.

### Phase 2 — Delete dead code (LOW complexity, can ship with Phase 1)

- Delete `app/owner/calendar/recurring/` (whole subdirectory).
- Delete `app/owner/calendar/_components/AvailabilityBlockFormPanel.tsx`,
  `BlockRowActions.tsx`, `WeekGrid.tsx`, `MonthGrid.tsx`, `WeekGridShoot.tsx`,
  `DaySidePanel.tsx`.
- Delete `app/client/book/_components/*` and `app/client/book/_lib/queries.ts`.
- Rewrite `app/owner/calendar/_lib/queries.ts` to the new `fetchEventsInRange` shape.
- Rewrite `app/owner/calendar/_actions.ts` to `createTimeBlock` / `updateTimeBlock` /
  `deleteTimeBlock`.
- Update `dateMath.ts` constants to 7/21.
- Stub `app/owner/calendar/page.tsx` and `app/client/book/page.tsx` to a placeholder.
  This keeps the build green until Phases 3–5.

### Phase 3 — Rebuild owner Week → Month → Agenda (MEDIUM, separate PR per view if you prefer)

- Start with `WeekView.tsx` since it's the densest layout. Once it renders shoots + a
  category-coded time block correctly, the others are mostly applying the same `EventChip`
  to a different layout.
- Then `MonthView.tsx` (chips inside a 6×7 grid with overflow handling).
- Then `AgendaView.tsx` (flat list grouped by day).
- `DayPanel.tsx` (slide-out) — used by Week and Month for click-into-day.
- `TimeBlockFormPanel.tsx` — category picker drives the rest of the form.
- All three views consume the same `CalendarEvent[]`. If you can swap views by changing
  `?view=`, the data layer is right.
- Recommend PR-splitting Week from Month/Agenda; the data layer + Week is the bulk of
  the risk.

### Phase 4 — Wire up new event types (LOW–MEDIUM, can fold into Phase 3)

- Most of this is already done if `TimeBlockFormPanel` supports the category enum end-to-
  end. The "wiring" is mostly:
  - Category-specific form fields (e.g., client picker only for `work_block`).
  - Default category by entry point (clicking "+ Block Time" from the day panel can default
    to `blocked`; a separate "+ Work Block" button defaults to `work_block`).
- Decide whether sonography is added through a dedicated "+ Sonography Shift" UI or the
  same form with category picker. Recommendation: same form, since Kelsey is the only
  user and the form is already category-aware.

### Phase 5 — Rebuild client booking with conflict-aware submit (MEDIUM, separate PR)

- New `ClientBookingCalendar.tsx`: client-facing month grid that shows *only* the client's
  own shoots. No tinting, no warnings, no leakage of Kelsey's other commitments.
- New `_actions.ts` `requestShoot` with the two-step conflict flow described in §7.7.
- `conflicts.ts` helper used by the action.
- Update `RequestShootFormPanel.tsx` to handle the "send anyway?" path.
- Keep `cancelMyShootRequest` as-is — unchanged shape.

### Phase 6 — Polish (LOW–MEDIUM, separate PR)

- Mobile breakpoint → auto-route to Agenda below 768px.
- Status textures on `EventChip` (line-through for cancelled/completed, dotted border for
  requested).
- Color tokens in `globals.css` for the four categories (mauve / slate / soft green /
  muted gray).
- Update `docs/features/scheduling.md` to reflect the new model.

---

## Top decisions blocking Phase 1

1. **Existing `availability_blocks` data — drop everything (§7.1)?** Recommended: yes.
   It's pre-launch; the recurring + available rows have no equivalent in the new model.
2. **`time_blocks.client_id` for work blocks — required or optional (§7.4)?** Recommended:
   optional, so "general editing/admin time not tied to a client" still has a home.
3. **Working-hours `CHECK` in the DB — yes/no/category-dependent (§7.6)?** Recommended:
   no DB constraint; enforce in the week grid + in the client booking validator only.
   The "7am–9pm" rule is really a client-booking rule, and sonography shifts realistically
   span outside that.
4. **Unified `time_blocks` vs three separate tables (§4)?** Recommended: unified with a
   `category` discriminator. Pushing back on your separate-tables lean — sonography and
   blocked are structurally identical, and three tables means three CRUD action sets for
   no payoff.
5. **Conflict response detail to the client (§7.7)?** Recommended: count + generic message
   only, no event detail. Preserves the "client doesn't see Kelsey's other commitments"
   privacy line.

Once you've answered these, Phase 1 (schema + types) is ready to go.

---

## Addendum — Locked decisions (2026-05-15)

The five open questions above are resolved. Recording them inline so future readers
don't have to dig through chat history.

1. **Existing `availability_blocks` data:** drop entirely. No migration insert.
2. **`time_blocks.client_id` for work blocks:** **optional**. A work block with no client
   attached is allowed ("general editing time").
3. **Working-hours `CHECK` constraint:** **dropped from the DB**. The 7am–9pm rule lives
   only in the week grid renderer and the client-booking validator. Sonography shifts can
   span outside this range without hitting a constraint error.
4. **Table strategy:** unified `time_blocks` table with a `category` enum. Shoots stays
   separate.
5. **Conflict response to client:** count + generic message only ("Kelsey has N other
   commitments at this time"). No event detail leaks to the client.

### Additional locked decisions

**A. PR strategy:** Phase 1 and Phase 2 ship as a single PR. The intermediate state
between them is uncompilable, and we will not land a broken commit on `main`. Phase 3 is
a separate PR (per-view sub-PRs optional).

**B. Timezone handling:** All `time_blocks` date+time assembly into `Date` objects MUST
use the fixed timezone constant `PORTAL_TIMEZONE = "America/Chicago"`. This lives in
`app/owner/calendar/_lib/timezone.ts` and is referenced explicitly by:

- `queries.ts` — `combineDateAndTimeInTimezone(date, time)` and
  `dateKeyInTimezone(utcDate)`.
- The convention is documented at the top of `types.ts` (the file every view imports).

Do **not** use `new Date("YYYY-MM-DDTHH:MM")` for time_blocks rows — that interprets the
string in server-local time and drifts silently on a UTC host.

### Phase 3 spec — `TimeBlockFormPanel` "All day" affordance

Phase 3 builds `TimeBlockFormPanel`. The form must include an **"All day"** checkbox.
When checked:

- `startTime` auto-fills to `"07:00"` and `endTime` to `"21:00"` (the portal working
  hours).
- The time inputs become read-only (or disabled) while checked.
- Unchecking restores the previous (or default) values.

**No schema change** is required for this. There is no `all_day` column on `time_blocks`;
it's pure UI sugar that picks the 7am–9pm range. This intentionally keeps the new model
free of the "nullable start/end means all-day" footgun that the old `availability_blocks`
table had.

---

## Phase 1+2 delivery summary

What landed in this PR:

- **Schema** (`supabase/schema.sql`): `time_blocks` CREATE TABLE replaces
  `availability_blocks`; legacy table dropped in the alignment block; no working-hours
  CHECK on the new table.
- **Types** (`lib/supabase.ts`): `AvailabilityBlockRecord` removed; `TimeBlockRecord` +
  `TimeBlockCategory` added; `Database.public.Tables.time_blocks` wired.
- **New modules**:
  - `app/owner/calendar/_lib/timezone.ts` — `PORTAL_TIMEZONE`,
    `combineDateAndTimeInTimezone`, `dateKeyInTimezone`.
  - `app/owner/calendar/_lib/types.ts` — `CalendarEvent`, `EventCategory`, `EventStatus`,
    with the timezone convention documented at file head.
- **Rewritten**:
  - `app/owner/calendar/_lib/queries.ts` — `fetchEventsInRange(start, end)` returning
    sorted `CalendarEvent[]`.
  - `app/owner/calendar/_actions.ts` — `createTimeBlock` / `updateTimeBlock` /
    `deleteTimeBlock`.
  - `app/owner/calendar/_lib/dateMath.ts` — `WEEK_GRID_START_HOUR = 7`,
    `WEEK_GRID_END_HOUR = 21`.
  - `app/owner/calendar/page.tsx`, `app/client/book/page.tsx` — `Placeholder` stubs to
    keep the build green until Phase 3 / Phase 5.
- **Deleted**:
  - `app/owner/calendar/recurring/` (whole subdirectory).
  - All of `app/owner/calendar/_components/*` — the empty directory was removed.
  - `app/client/book/_components/*` and `app/client/book/_lib/queries.ts`.

What did NOT change:

- `app/client/book/_actions.ts` — `requestShoot` and `cancelMyShootRequest` stay as-is.
  Phase 5 adds the conflict-aware path.
- `app/owner/shoots/*` — untouched.
- `lib/currentClient.ts` — untouched.
- All other modules (clients, time logs, messages, files, dashboards).

Status: `npx tsc --noEmit` runs clean. Ready to merge.
