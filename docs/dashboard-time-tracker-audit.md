# Dashboard + Time Tracker — Pre-Build Audit

Read-only reconnaissance for the planned `/owner/dashboard` (smart board) and
`/owner/time` (global time tracker) features. All claims cite exact file paths
and line numbers.

## 1. `time_logs` table — current write paths

Writes happen in exactly one place: `addTimeLogAction` and `deleteTimeLogAction`
in the client-detail server actions. There is no global "Log Time" UI — the only
logger is the per-client `TimeTab` slide-panel inside the client detail page.

Table columns (from `supabase/schema.sql:104-113`):

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | default `gen_random_uuid()` |
| `client_id` | uuid not null | FK → `clients(id) on delete cascade` |
| `logged_by` | text not null | free-text — see below |
| `date` | date not null | day the work happened (not a timestamp) |
| `hours` | numeric not null | |
| `category` | text not null | check: `editing`, `planning`, `filming`, `admin`, `communication` |
| `notes` | text | nullable |
| `created_at` | timestamptz not null | default `now()` |

Indexes: `time_logs_client_id_idx`, `time_logs_date_idx` (`supabase/schema.sql:115-116`).

TypeScript mirror at `lib/supabase.ts:78-87` (`TimeLogRecord`) and category enum
at `lib/supabase.ts:11-16` (`TimeLogCategory`).

**Inserts:**
- `app/owner/clients/_actions.ts:34-70` — `addTimeLogAction(input: AddTimeLogInput)`.
  Validates category, hours > 0, date present. Inserts:
  ```ts
  .insert({
    client_id: input.clientId,
    logged_by: guard.ownerLabel,
    date: input.date,
    hours: input.hours,
    category: input.category,
    notes: input.notes?.trim() || null,
  })
  ```
- Called only from `app/owner/clients/[id]/_components/TimeTab.tsx:70-76`.

**Deletes:**
- `app/owner/clients/_actions.ts:72-86` — `deleteTimeLogAction(logId, clientId)`.
- Called only from `app/owner/clients/[id]/_components/TimeTab.tsx:89-94`.

**Updates:** none. There is no edit-time-log code path.

**Logger UI:** the slide-panel inside `TimeTab` (`app/owner/clients/[id]/_components/TimeTab.tsx:213-299`).
Fields: date (defaults to today via `todayIso()` at `:33-39`), hours (default `"1"`,
min `0.5`, step `0.5`), category (default `"editing"`), notes. No standalone
modal, no global page.

**How `logged_by` is populated:** human-readable string, not an ID. The value is
`guard.ownerLabel` from `requireOwner()`:

```ts
// lib/auth.ts:15-19
const ownerLabel =
  user?.fullName ||
  user?.primaryEmailAddress?.emailAddress ||
  "Owner";
```

So `logged_by` is typically "Kelsey Smith" or her email — not a Clerk user id,
not a `clients.id`. Note the schema only declares `text not null` (no FK), so
nothing prevents writing arbitrary strings.

---

## 2. `time_logs` reads

Three read sites, all server-side, all via `getSupabaseServiceClient()`.

**A. Client list page — sum hours per client for the current calendar month.**
`app/owner/clients/_lib/queries.ts:56-73` inside `fetchClientsWithRelations()`:

```ts
const { start, end } = currentMonthRange();
// ...
const { data: logs, error } = await supabase
  .from("time_logs")
  .select("client_id, hours, date")
  .in("client_id", clientIds)
  .gte("date", start)
  .lte("date", end);
```
Reduced in-process into a `Map<clientId, hours>` (`:67-72`).

`currentMonthRange()` at `app/owner/clients/_lib/queries.ts:17-24` builds
month bounds in **UTC**, not Central — relevant for §10.

**B. Client detail page — all time logs for one client.**
`app/owner/clients/_lib/queries.ts:128-133` inside `fetchClientDetail()`:

```ts
supabase
  .from("time_logs")
  .select("*")
  .eq("client_id", id)
  .order("date", { ascending: false })
  .order("created_at", { ascending: false }),
```
`hoursThisMonth` for that client is then computed in-process at
`app/owner/clients/_lib/queries.ts:164-167` by re-filtering the already-loaded
log array against `currentMonthRange()`.

**C. Documentation references only:** `docs/features/scheduling.md`,
`dbs-portal-blueprint-v1.md` — no executable code.

No helper function exists that aggregates `time_logs` across multiple clients
for a date range other than the implicit "current month" loop in (A).

---

## 3. Existing dashboard/time routes

Both routes exist and are pure placeholders.

**`/owner/dashboard`** — `app/owner/dashboard/page.tsx:1-5`:
```ts
import { Placeholder } from "@/components/ui/Placeholder";
export default function OwnerDashboardPage() {
  return <Placeholder eyebrow="Owner — Dashboard" title="Dashboard" />;
}
```

**`/owner/time`** — `app/owner/time/page.tsx:1-5`:
```ts
export default function OwnerTimePage() {
  return <Placeholder eyebrow="Owner — Time Tracker" title="Time Tracker" />;
}
```

`Placeholder` is at `components/ui/Placeholder.tsx:7-23` — eyebrow + title +
"This section is coming soon." description.

**`app/owner/layout.tsx`** structure:
- Auth gate: `currentUser()` + `publicMetadata.role === "owner"`, else redirect
  to `/sign-in` or `/` (`:23-31`).
- `SidebarWithUnread` (`components/ui/SidebarWithUnread.tsx`) renders the left
  nav and a polled unread badge — see §6 and §7.
- `TopBar` (`components/ui/TopBar.tsx`) renders the title resolved from
  `navItems` and a Clerk `UserButton`. **No action slots** — there's no
  designed spot in the top bar for a global "Log Time" entry point; you'd
  either extend `TopBar` to accept a `right` slot, or place the entry point
  inside individual pages.
- Sidebar nav array (`app/owner/layout.tsx:7-16`):
  ```ts
  const ownerNav: SidebarNavItem[] = [
    { label: "Dashboard", href: "/owner/dashboard" },
    { label: "Clients", href: "/owner/clients" },
    { label: "Shoots", href: "/owner/shoots" },
    { label: "Calendar", href: "/owner/calendar" },
    { label: "Time Tracker", href: "/owner/time" },
    { label: "Financials", href: "/owner/financials" },
    { label: "Messages", href: "/owner/messages" },
    { label: "Settings", href: "/owner/settings" },
  ];
  ```
  Items only support `{label, href, badge?: number}` (`components/ui/Sidebar.tsx:7-11`).

---

## 4. Shoots data — for a Today panel

Shoots are queried in two helper modules. There is no "today" or "this week"
helper today — only `fetchUpcomingShoots`, `fetchPastShoots`,
`fetchShootsInRange`, and `fetchEventsInRange` (which also pulls
`time_blocks`).

**`shoots.scheduled_at`** is `timestamptz not null` (`supabase/schema.sql:78`),
i.e. a single UTC instant. There is no separate date/time.

**Timezone handling:** UTC stored, rendered as wall-clock in
`America/Chicago` via `app/owner/calendar/_lib/timezone.ts:14`
(`PORTAL_TIMEZONE = "America/Chicago"`). The full convention is
documented at `app/owner/calendar/_lib/timezone.ts:1-12`. The day-bucketing
helper is `dateKeyInTimezone(d)` (`:31-42`); the calendar uses it to assign a
UTC timestamp to a wall-clock date.

**Query helpers (owner side):**
- `app/owner/shoots/_lib/queries.ts:11-30` — `fetchUpcomingShoots(limit?)`:
  `status in ('requested','confirmed')` AND `scheduled_at >= now`, ascending,
  client names attached via `attachClientNames` (`:70-92`).
- `app/owner/shoots/_lib/queries.ts:33-52` — `fetchPastShoots(limit?)`:
  `scheduled_at < now OR status in ('completed','cancelled')`, descending.
- `app/owner/shoots/_lib/queries.ts:55-68` — `fetchShootsInRange(start, end)`:
  `[start, end)` on `scheduled_at`, ascending. **This is the closest existing
  primitive for a "today/this week" panel.**
- `app/owner/calendar/_lib/queries.ts:53-107` — `fetchEventsInRange(start, end)`:
  joins shoots + time_blocks into a single `CalendarEvent[]`. Note shoots are
  fetched with a UTC `scheduled_at` filter (`:69-70`), and time_blocks are
  fetched with a date-key filter widened ±1 day (`:60-61, 76-77`) to absorb
  DST/timezone drift. Re-using this for the dashboard buys both event types in
  one round-trip.

**Page consumers:**
- `app/owner/shoots/page.tsx:21-25` calls `fetchUpcomingShoots()` and
  `fetchPastShoots()`.
- `app/owner/calendar/page.tsx:148, 251, 357` call `fetchEventsInRange()` for
  week/month/agenda views.
- `app/owner/clients/_lib/queries.ts:134-142` — next-shoot-for-this-client
  query embedded in `fetchClientDetail()`.

---

## 5. Clients data — for a roster summary

**`status` enum values** (`supabase/schema.sql:16`):
```sql
status text not null check (status in ('active', 'onboarding', 'inactive', 'lead'))
       default 'onboarding'
```
TypeScript mirror at `lib/supabase.ts:5`.

**Primary fetcher with package joined: `fetchClientsWithRelations()`**
(`app/owner/clients/_lib/queries.ts:26-85`). Runs three parallel queries
(clients, projects, packages), then a fourth for `time_logs` to compute
`hoursThisMonth`. Returns `ClientWithRelations[]` (`:10-15`):
```ts
{ client: ClientRecord, project: ProjectRecord | null, pkg: PackageRecord | null, hoursThisMonth: number }
```
Note: only ONE project per client is kept (first-seen-wins, `:48-53`), with no
ordering — i.e. if a client has multiple projects the chosen one is effectively
arbitrary.

**Pattern used:** plain server component calling the helper directly. No server
actions, no route handlers, no React Server Cache layer.
- `app/owner/clients/page.tsx:20-23` (clients list) — `export const dynamic = "force-dynamic"`.
- `app/owner/shoots/page.tsx:21-25` — also calls `fetchClientsWithRelations()`
  to populate the shoot-form client picker.
- `app/owner/clients/[id]/page.tsx:44-47` uses the single-client version
  `fetchClientDetail(id)` (`app/owner/clients/_lib/queries.ts:106-177`).

**Lighter alternative:** `fetchClientsLite()`
(`app/owner/calendar/_lib/queries.ts:247-257`) returns `{id, name}[]` only —
useful when a dashboard panel only needs names.

The inbox query (`fetchInboxClients`, `app/owner/messages/_lib/queries.ts:32-106`)
excludes `status = 'inactive'` (`:38`) — that's the existing convention for
"active roster".

---

## 6. Messages — unread count surface

The total-unread-for-owner count is computed by the
`/api/messages/unread-counts` route, owner branch
(`app/api/messages/unread-counts/route.ts:19-40`):

```ts
const { data, error } = await supabase
  .from("messages")
  .select("client_id")
  .eq("sender_role", "client")
  .is("read_at", null);
// ...
let total = 0;
for (const row of (data ?? []) as { client_id: string }[]) {
  counts[row.client_id] = (counts[row.client_id] ?? 0) + 1;
  total += 1;
}
return NextResponse.json({ counts, total });
```

The endpoint returns BOTH `counts: Record<clientId, number>` AND `total` in a
single response. Current consumers only use one of them:
- `SidebarWithUnread` (`components/ui/SidebarWithUnread.tsx:31-53`) — reads
  `json.total` for owner badge.
- `MessagesInbox` re-derives per-client counts from the inbox query
  (`app/owner/messages/_lib/queries.ts:52-58, 71-77`) rather than from this
  endpoint.

**No reusable hook or helper.** The fetch + polling pattern is inlined into
`SidebarWithUnread`. The route handler itself can be called from any new client
component, but there is no `useUnreadCount()` hook.

Per-client unread bucketing for the inbox is duplicated logic
(`app/owner/messages/_lib/queries.ts:71-77` vs. `app/api/messages/unread-counts/route.ts:32-37`).

---

## 7. Polling / live-update patterns

**Not abstracted.** The "30s poll + visibility-pause + cross-component refresh
on `messages:invalidate-counts`" pattern is duplicated inline in three places:

1. `components/messages/MessageThread.tsx:216-259` — message-thread polling.
2. `components/ui/SidebarWithUnread.tsx:59-115` — unread badge polling.
3. `app/owner/messages/_components/MessagesInbox.tsx:67-121` — inbox list
   polling.

Each defines its own `const POLL_INTERVAL_MS = 30_000`
(`MessageThread.tsx:15`, `SidebarWithUnread.tsx:6`, `MessagesInbox.tsx:15`),
each has its own `start()`/`stop()`/`onVisibility()` closure, each separately
listens for `window.dispatchEvent(new CustomEvent("messages:invalidate-counts"))`
(dispatched once, from `MessageThread.tsx:104`).

There is no `useInterval`, `usePolledFetch`, or `useVisibilityPolling` utility
under `lib/` or `components/`. The fourth `visibilitychange` hit
(`app/finalizing/page.tsx`) is a different feature (post-sign-up redirect
polling) and not part of the messages pattern.

If the dashboard wants to poll its KPIs the same way, the code must be
copy-pasted today — or extracted now.

---

## 8. Auth helpers

`lib/auth.ts` exports two helpers (`lib/auth.ts:8-32`):
- `requireOwner()` → `{ok: true, ownerLabel} | {ok: false, error}` — for server
  actions.
- `requireOwnerApi()` → `NextResponse | null` (early-return error response, or
  `null` to proceed) — for route handlers.

Both check `auth().userId` then `currentUser().publicMetadata.role === "owner"`.

**Adoption is partial.** Server actions for shoots still have an inline copy:
`app/owner/shoots/_actions.ts:23-33` defines its own `ensureOwner()` and uses
it throughout (called at `:72, 137, 252`). It is functionally equivalent to
`requireOwner()` but does not return `ownerLabel`.

| caller | uses helper? |
| --- | --- |
| `app/owner/clients/_actions.ts:10` | yes — `requireOwner` (`:37, 76, 96`) |
| `app/owner/calendar/_actions.ts:9` | yes — `requireOwner` (`:84, 128, 202`) |
| `app/owner/shoots/_actions.ts` | **no** — inline `ensureOwner` (`:23-33`) |
| `app/api/messages/inbox/route.ts:2` | yes — `requireOwnerApi` (`:6`) |
| `app/api/clients/[id]/route.ts:9` | yes — `requireOwnerApi` (`:58, 179`) |
| `app/api/messages/route.ts` | **no** — inline `auth()` + `currentUser()` + role check (`:19-27, 126-134`); accepts both owner and client |
| `app/api/messages/read/route.ts` | **no** — same inline pattern (`:14-22`) |
| `app/api/messages/unread-counts/route.ts` | **no** — same inline pattern (`:7-15`) |
| `lib/currentClient.ts` | separate client-role helper (`:18-32`, `:39-43`) |

For owner-only ID-aware work the dashboard does, `requireOwner()` is the
existing helper. Messages routes deliberately accept both roles, so they're not
candidates for `requireOwner`.

---

## 9. UI primitives

`components/ui/` contents:
- `Button.tsx` — `Button` (`:18-34`). Primary + secondary variants only.
- `ConfirmDialog.tsx` — modal w/ backdrop, escape key, busy state, `default`/`danger`/`success` variants (`:22-100`).
- `Placeholder.tsx` — eyebrow + title + body, used by the two placeholder pages (`:7-23`).
- `Sidebar.tsx` — left nav w/ optional `badge` per item (`:18-134`).
- `SidebarWithUnread.tsx` — client wrapper that injects badge for the
  messages link (`:22-131`).
- `StatusPill.tsx` — tone-based pill: `success`/`warning`/`danger`/`neutral`/`accent` (`:18-28`).
- `TopBar.tsx` — auto-titled bar w/ Clerk `UserButton`. No action slot (`:23-53`).

**Card / stat-tile equivalent** lives one folder deeper, only used by the
client detail page:
- `app/owner/clients/[id]/_components/StatCard.tsx:10-52` — label + value
  (Playfair display, 26px), optional `hint`, `tone: "default" | "danger"`.
  Not generic-import-friendly today (lives under a route-specific folder) but
  is the only existing "stat tile" abstraction.

**No empty-state component.** Each page hand-rolls one — e.g.
`app/owner/clients/page.tsx:36-53` (`"No clients yet."`), `app/owner/shoots/page.tsx:98-110`,
`app/owner/messages/_components/MessagesInbox.tsx:153-154`.

**No loading-skeleton component.** The closest pattern is the simple text
loader `app/owner/messages/_components/MessagesInbox.tsx:247-253`
("Loading messages..." style).

**Chart library:** none. `package.json:14-21` lists only `@clerk/nextjs`,
`@supabase/supabase-js`, `next`, `react`, `react-dom`, `resend`, `svix`. There
is no Recharts, no Chart.js, no Visx, no D3. A monthly bar chart will need
either a new dependency or hand-built `<div>` bars.

Also: `components/messages/MessageThread.tsx`, `components/messages/QuickMessageButton.tsx`
are reusable for embedding chat anywhere on the dashboard.

---

## 10. Package hours budget logic

**Where "hours used this month" is calculated:**
- `app/owner/clients/_lib/queries.ts:56-73` — for the clients list (all clients
  in one batched query).
- `app/owner/clients/_lib/queries.ts:164-167` — for a single client on the
  detail page, by re-filtering the already-loaded full log list.

Both reuse `currentMonthRange()` at `app/owner/clients/_lib/queries.ts:17-24`:
```ts
function currentMonthRange(now = new Date()): { start: string; end: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}
```
This uses **UTC**, not `PORTAL_TIMEZONE`. Around month boundaries the bucket
will disagree with the calendar's Central-time convention by ≤24 hours.

**Where the budget is rendered:**
`app/owner/clients/[id]/_components/OverviewTab.tsx:26-48` reads
`pkg?.monthly_hours`, computes `remaining = budget - hoursThisMonth`, and
applies a `danger` tone via `StatCard` when negative.

**Is `packages.monthly_hours` populated reliably?** Yes — it's a `numeric not null`
column (`supabase/schema.sql:49`) and the seed file inserts three rows with
real values (`supabase/seed.sql:4-7`):
```sql
('Starter', 'starter', 8,  750,  ...),
('Growth',  'growth',  16, 1200, ...),
('Premium', 'premium', 24, 2000, ...);
```
Whether a given client has a `package_id` set on their project is a separate
question — `OverviewTab.tsx:26-28` and `app/owner/clients/_lib/queries.ts:75-83`
both treat `pkg` and therefore `budget` as nullable (`pkg?.monthly_hours ?? null`).
A client whose project has no `package_id` will show "—" for budget and
remaining.

No "alert when N% of budget consumed" / "overrun client list" / "month-over-month
hours" helper exists today. The only existing per-client budget surface is the
detail-page Overview tab.
