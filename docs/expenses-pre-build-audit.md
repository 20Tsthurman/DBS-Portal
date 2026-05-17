# Pre-build Audit: Expenses Module

Read-only inventory of what exists before any feature code is written.

## 1. Existing financials route and components

Files under `app/owner/financials/`:

- `app/owner/financials/page.tsx` (lines 1-5): Placeholder only. Renders `<Placeholder eyebrow="Owner — Financials" title="Financials" />` from `components/ui/Placeholder.tsx` (lines 1-23). No sub-routes, no `_components/`, no `_lib/`, no `_actions.ts`.

Route status: pure stub. Nothing partially built.

Separate `app/owner/expenses/` directory: does not exist (Glob `app/owner/expenses/**/*` returned no files).

Owner sidebar nav (`app/owner/layout.tsx` lines 7-16): single entry `{ label: "Financials", href: "/owner/financials" }` at line 13. No separate "Expenses" item. Order: Dashboard, Clients, Shoots, Calendar, Time Tracker, Financials, Messages, Settings.

## 2. Expenses schema and current data model

`expenses` table (`supabase/schema.sql` lines 139-148):

| Column       | Type        | Constraints |
|--------------|-------------|-------------|
| id           | uuid        | PRIMARY KEY, default `gen_random_uuid()` |
| category     | text        | NOT NULL, CHECK in enum (see below) |
| description  | text        | nullable |
| amount       | numeric     | NOT NULL — no CHECK constraint |
| date         | date        | NOT NULL |
| receipt_url  | text        | nullable |
| notes        | text        | nullable |
| created_at   | timestamptz | NOT NULL, default `now()` |

No `client_id` FK. No `created_by` / owner attribution column.

Category enum (CHECK constraint, schema.sql line 141 and re-asserted at lines 242-244): `'equipment', 'software', 'travel', 'marketing', 'meals', 'other'`.

Indexes (`supabase/schema.sql` line 150): `expenses_date_idx on expenses (date)`. Only one. No index on `category`.

TypeScript mirror `ExpenseRecord` (`lib/supabase.ts` lines 101-110) — 1:1 with schema:
```
id: string; category: ExpenseCategory; description: string | null;
amount: number; date: string; receipt_url: string | null;
notes: string | null; created_at: string;
```
`ExpenseCategory` union at `lib/supabase.ts` lines 18-24 matches the SQL enum exactly. Registered in `Database` type at `lib/supabase.ts` line 172. No divergence.

Seed data: `supabase/seed.sql` (lines 1-7) seeds packages only — no `expenses` inserts anywhere in the repo.

## 3. Existing expenses code paths

Repo-wide grep for `expenses` returns three files: `lib/supabase.ts`, `supabase/schema.sql`, `dbs-portal-blueprint-v1.md` (planning doc). Grep for `Expense` / `expense` across `app/` and `components/` returns no matches.

- No reads or writes to the `expenses` table anywhere.
- No queries helper (no `app/owner/financials/_lib/queries.ts` — no `_lib/` folder under financials at all).
- No server actions related to expenses.
- No expense-related UI components.

Only artifacts are the type and table registration in `lib/supabase.ts`.

## 4. Supabase Storage — for receipt uploads

No Supabase Storage configuration in the repo:

- `supabase/` contains exactly two files: `schema.sql`, `seed.sql`. No buckets, no storage policies, no migration files (Glob `supabase/**/*` returns just these two).
- Grep for `storage|bucket|Storage` across `supabase/` returns no matches.
- Grep for `supabase.storage` / `.storage.from` across the repo returns no matches.

No existing file-upload UI components anywhere:

- Grep for `upload|Upload|FileInput|drop.?zone|DropZone` across `components/` returns no matches.
- Grep for `upload` across `lib/` returns only the `files` table type fields at `lib/supabase.ts` lines 125, 127, 128 (`file_url`, `uploaded_at`, `uploaded_by`) — type declaration only.
- `files` table exists (`supabase/schema.sql` lines 170-181) with `file_url text not null`, but no code reads or writes it. The client detail "Files" tab renders a "File management coming soon." placeholder (`app/owner/clients/[id]/page.tsx` line 88).

No helper for uploading to Storage / getting a signed or public URL. No file-size limits, accepted-types config, or storage policies defined anywhere.

## 5. Income / invoices status check

`invoices` table exists (`supabase/schema.sql` lines 121-134):

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| client_id | uuid | NOT NULL, FK clients(id) ON DELETE CASCADE |
| amount | numeric | NOT NULL |
| due_date | date | nullable |
| paid_at | timestamptz | nullable |
| status | text | NOT NULL, CHECK in (draft, sent, paid, overdue), default 'draft' |
| stripe_payment_link | text | nullable |
| line_items | jsonb | NOT NULL, default `'[]'::jsonb` |
| created_at | timestamptz | NOT NULL, default now() |

Indexes: `invoices_client_id_idx`, `invoices_status_idx` (schema.sql lines 133-134).

TypeScript mirror `InvoiceRecord` at `lib/supabase.ts` lines 89-99. `InvoiceStatus` union at line 17.

No separate `income` table or column. Grep for `income` across the repo returns zero matches.

Code paths touching invoices: navigation/placeholder references only.

- `app/client/layout.tsx` line 12 — sidebar entry `{ label: "Invoices", href: "/client/invoices" }`.
- `app/owner/clients/[id]/page.tsx` line 91-94 — tab key `"invoices"` rendering `<PlaceholderPanel message="Invoices coming in Phase 4." />`.
- `app/owner/clients/[id]/_components/TabNav.tsx` line 10 — tab key declaration.

No reads or writes of the `invoices` table. No `/client/invoices/page.tsx` exists.

`time_logs.category` enum (`supabase/schema.sql` line 110): `editing, planning, filming, admin, communication`. Zero overlap with expenses categories (`equipment, software, travel, marketing, meals, other`).

## 6. CSV export pattern reuse

Generator: server action `exportMonthlyTimeLogsAction` in `app/owner/time/_actions.ts` lines 56-98. Action guards via `requireOwner()` (line 59), fetches rows via `fetchMonthlyTimeLogsForExport()` (line 63, defined `app/owner/time/_lib/queries.ts` lines 259-264), assembles the CSV string in-memory (lines 66-81), and returns it inside `ActionResult<MonthlyCsvExport>`. RFC 4180 CRLF line terminator (line 81).

Header constant: `CSV_HEADERS` at `app/owner/time/_actions.ts` lines 24-32.

Download trigger: client component `ExportMonthlyCsvButton` in `app/owner/time/_components/ExportMonthlyCsvButton.tsx` lines 1-58. On click (lines 16-37) it calls the action inside `useTransition`, builds a `Blob` (line 26), creates an object URL, programmatically clicks a synthetic `<a download>`, then revokes the URL on a `setTimeout(..., 0)`. Failure path: `alert(result.error ?? "Failed to export CSV.")` (line 21).

Filename pattern: `time-logs-${monthKey}.csv` where `monthKey` is `YYYY-MM` (`app/owner/time/_actions.ts` line 87, monthKey from `currentMonthKeyForExport()` at `_lib/queries.ts` lines 267-270).

`csvEscape` helper: defined `app/owner/time/_actions.ts` lines 39-47. Local — not exported, not in a shared `lib/`. Quotes any field containing `,` / `"` / CR / LF, escapes internal `"` as `""`, treats null/undefined/empty as empty string.

## 7. Form patterns reuse

`QuickLogForm` lives at `app/owner/time/_components/QuickLogForm.tsx` lines 1-346. NOT in a slide panel — it is an inline-rendered form embedded in a `DashboardCard` on `/owner/time` (see `app/owner/time/page.tsx` lines 76-78). Single-row layout with inline labels.

Validation/error/success state (lines 100-156):

- Local state: `error`, `success` strings + `successTimer` ref (lines 83-85).
- Synchronous client-side validation (lines 109-119) — required fields + `parsedHours < 0.5`.
- Calls action `addTimeLogAction` (imported from `@/app/owner/clients/_actions` at line 12) inside `startTransition` (line 128).
- On `!result.ok`: `console.error` + `setError(result.error ?? "Failed to log time.")` + retains values (lines 136-140).
- On success: clears `hours` and `notes` only (lines 142-143), sets success string with snapshot client name + hours (lines 144-146), schedules a 4000ms fade timer (`SUCCESS_FADE_MS` line 35; timer at lines 147-151).

SSR refresh: `router.refresh()` at line 154 inside the success branch. Re-renders server components below the form without remounting the client form, preserving the success-fade timer and the picker values.

Edit pattern: QuickLogForm is create-only. The slide-out edit pattern used elsewhere (e.g. clients, shoots) lives in `app/owner/clients/_components/SlidePanel.tsx` lines 1-97 — fixed right-side 400px panel, Escape-to-close, backdrop click closes. Reused by `ClientFormPanel` and `ShootFormPanel`. No expenses-related form exists yet.

## 8. Existing money / currency formatting

Helper: `formatCurrency(value)` defined at `app/owner/clients/_lib/format.ts` lines 3-9. Returns `"—"` for null/undefined, otherwise `` `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` ``. Whole dollars only. No cents.

Imported by:

- `app/owner/clients/page.tsx` line 10, used line 91 (`Monthly Value` column).
- `app/owner/clients/[id]/page.tsx` line 8, used line 111 (header `$X/mo`).
- `app/owner/dashboard/_components/ClientRosterWidget.tsx` line 3, used line 65 — this is the "Monthly value" StatCard on the dashboard. Sum is computed locally (line 28-34), formatted via `formatCurrency`.

One inline divergence: `app/owner/clients/_components/ClientFormPanel.tsx` line 232 hand-rolls `${pkg.monthly_price.toLocaleString()}/mo` inside an `<option>` rather than calling `formatCurrency`.

No alternative currency helper anywhere; `formatCurrency` is the only one.

## 9. Date filtering and month navigation

`currentMonthRange(now: Date = new Date())` defined at `app/owner/calendar/_lib/timezone.ts` lines 37-51. Returns `{ start: string; end: string }` — YYYY-MM-DD wall-clock dates in `PORTAL_TIMEZONE` (`America/Chicago`, declared line 14). Start is always the 1st; end is computed via the `Date.UTC(year, month, 0).getUTCDate()` last-day trick (line 46). Suitable for `gte`/`lte` filters on a SQL `date` column.

Imported by `app/owner/time/_lib/queries.ts` (lines 9, 219, 262, 268) and `app/owner/clients/_lib/queries.ts` (line 9, per phase2 audit). No local copies.

Related helpers in the same file:

- `currentMonthKey(tz?)` (lines 278-281) — returns current `YYYY-MM`.
- `addMonthsToMonthKey(monthKey, delta)` (lines 284-290) — month arithmetic with year rollover; works for previous-month navigation by passing `-1`.
- `parseMonthKey` / `formatMonthKey` (lines 267-275).
- `formatMonthLabel(monthKey)` (lines 310-313) — `"May 2026"`.
- `monthGridDateKeys(monthKey)` (lines 297-307) — 42-day calendar grid.

No "previous-month range" convenience: callers compose `addMonthsToMonthKey(currentMonthKey(), -1)` and would need a `monthRangeForKey(key)` shape. None exists.

No year-to-date helper exists. No arbitrary-range helper for `[startDate, endDate]` other than `currentMonthRange`. The time-tracker's `currentWeekRangeMondayStart` is a private function at `app/owner/time/_lib/queries.ts` lines 53-63 (not exported).

## 10. UI primitives — what's available

Confirmed in `components/ui/`:

- `Button` — `components/ui/Button.tsx` lines 1-35. Variants `primary | secondary` (line 3).
- `StatCard` — `components/ui/StatCard.tsx` lines 1-52. Props: `label, value, tone ("default"|"danger"), hint?`.
- `DashboardCard` — `components/ui/DashboardCard.tsx` lines 3, 15. Props: `eyebrow, title, children`.
- `StatusPill` — `components/ui/StatusPill.tsx` lines 1-28. Tones: `success | warning | danger | neutral | accent`.
- `ConfirmDialog` — `components/ui/ConfirmDialog.tsx` lines 1-184. Props: `open, onCancel, onConfirm, title, body, confirmLabel?, cancelLabel?, variant ("default"|"danger"|"success"), busy?`.
- `Placeholder` — `components/ui/Placeholder.tsx` lines 1-23.
- `Sidebar` / `SidebarWithUnread` / `TopBar` — present.

`SlidePanel` lives outside `components/ui/`: `app/owner/clients/_components/SlidePanel.tsx` lines 1-97. Reused by `ShootFormPanel`, `ClientFormPanel`, `TimeBlockFormPanel`, `RequestShootFormPanel` (grep `SlidePanel` confirms five consumer files).

No generic table component. Each list page hand-rolls `<table><thead><tbody>` (confirmed: `app/owner/clients/page.tsx` lines 62-110, `app/owner/shoots/page.tsx`, `app/owner/clients/[id]/_components/TimeTab.tsx`).

No file-input component, no drop-zone, no upload UI primitive of any kind (Section 4).

No `Skeleton` / `EmptyState` primitive in `components/`. Empty states are hand-rolled per page — e.g. `app/owner/clients/page.tsx` lines 35-53 has an inline "No clients yet" block; `app/owner/time/page.tsx` lines 81-92 has an inline "No time logged this week yet." paragraph.

## 11. Authentication and authorization patterns

`requireOwner()` defined at `lib/auth.ts` lines 8-20. Returns `{ ok: true; ownerLabel } | { ok: false; error }`. Uses Clerk `auth()` + `currentUser()`, checks `publicMetadata.role === "owner"`. Sibling `requireOwnerApi()` (lines 22-32) returns a `NextResponse` for route handlers.

Used by every owner-only action. Sampled call site: `app/owner/time/_actions.ts` line 59 (`const guard = await requireOwner(); if (!guard.ok) return { ok: false, error: guard.error };`). Phase2 audit confirms shoots actions also migrated to it (see `docs/phase2-post-build-audit.md` §1 line 17).

Layout-level guard at `app/owner/layout.tsx` lines 23-31 — `currentUser()` + role check, redirects `/sign-in` or `/`. Backstop for the per-action checks.

No expenses-specific Clerk roles needed. The schema has no `created_by` column, so no per-owner attribution to enforce. Single owner-only access is sufficient.

## 12. Backlog from prior audits

From `docs/phase2-post-build-audit.md`:

- `UnreadCountsResponse` unused export (§2 line 28, §10 line 118) — noted, ignored per instructions.
- `WeeklyBreakdown` / `MonthlyBreakdown` unused exports (`app/owner/time/_lib/queries.ts` lines 27, 36 per §2 line 29 and §10 line 119). Shape pattern worth mirroring:
  ```
  WeeklyBreakdown  { rangeLabel, weekStartKey, weekEndKey, totalHours, byClient: ClientHours[], byCategory: CategoryHours[] }
  MonthlyBreakdown { monthLabel, monthKey, totalHours, byClient: ClientHours[] }
  ```
  Both are domain breakdowns parallel to what an expenses module would compute (`byCategory`, `byMonth`). Currently exported but not consumed — callers destructure inline off the awaited promise.
- `time_logs.hours` CHECK constraint deferred (§7 line 81, §10 line 124). Same situation applies to `expenses.amount` (`supabase/schema.sql` line 143) — declared `numeric not null` with no `check (amount > 0)` or `check (amount >= 0)`. No in-app insert path exists to enforce a minimum yet.
- Other potentially-relevant carryovers:
  - §5 line 60 — `fetchClientsWithRelations()` double-call on dashboard. If an expenses widget is added to the dashboard and reuses the same client roster, this would be a third caller.
  - §10 line 121 — `exportMonthlyTimeLogsAction` has no try/catch on the client side around the awaited action; a thrown error becomes an unhandled promise rejection rather than the `alert(...)` path. Direct precedent if expenses ships a CSV export.

From `docs/shoot-detail-pre-build-audit.md`:

- §10 confirms the `files` table is client-scoped only (no polymorphic FK to other entities like shoots) and "File upload components: Not found" — directly relevant since expense receipts would either need to bolt onto Supabase Storage from scratch or reuse a yet-to-be-built upload primitive.
- §11 confirms the same UI primitives inventory captured in Section 10 above (StatCard, DashboardCard, StatusPill, ConfirmDialog, SlidePanel, Button).
