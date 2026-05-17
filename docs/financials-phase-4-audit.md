# Phase 4 Audit — Financials Smart Layer (Suggestions)

Read-only reconnaissance of the surfaces Phase 4 will touch. Phase 4 adds
**lazy, on-page-load** suggestion computation that surfaces inline ghost
suggestion rows on `/owner/financials` (✓ accept, ✗ dismiss-for-month)
plus a Mileage reconciliation strip for shoots-without-mileage. No cron.
This doc inventories what exists, what's missing, and what gotchas to plan
around. No code changes.

---

## 1. Clients + Packages (income suggestion source)

**Where the data lives**

- Clients query module: `app/owner/clients/_lib/queries.ts` (the path is
  `_lib/queries.ts`, NOT `_queries.ts` — worth noting; the calendar
  module uses `_lib/queries.ts` too).
- The canonical joined fetcher: `fetchClientsWithRelations()` at
  `app/owner/clients/_lib/queries.ts:22-81`. **Already wrapped in
  React's `cache()`** so multiple Phase-4 callers in the same render
  share one query bundle. Returns `ClientWithRelations[]` with `client`,
  `project`, `pkg`, and `hoursThisMonth` per row.

**"Active brand-retainer client" definition**

- `clients.type` is `'brand' | 'bride'` (`lib/supabase.ts:3`).
- `clients.status` is `'active' | 'onboarding' | 'inactive' | 'lead'`
  (`lib/supabase.ts:4`). The existing in-codebase precedent for
  "currently retaining" is the BudgetStatusWidget filter at
  `app/owner/dashboard/_components/BudgetStatusWidget.tsx:45-51`:
  ```ts
  (r.client.status === "active" || r.client.status === "onboarding") &&
  r.pkg !== null &&
  typeof r.pkg.monthly_hours === "number" &&
  r.pkg.monthly_hours > 0
  ```
  Phase 4's "active brand-retainer" should reuse this exact rule and
  additionally filter `r.client.type === "brand"`.
- ClientRosterWidget uses a slightly looser filter (`status !==
  "inactive"`, at `ClientRosterWidget.tsx:17`) for general display; not
  the right precedent for billing.

**Where the monthly retainer amount lives**

- On the **package**, not the client: `packages.monthly_price numeric`
  (`supabase/schema.sql:50`). Reached via the project FK:
  `clients → projects.client_id → projects.package_id → packages`.
  `fetchClientsWithRelations` already resolves this into `pkg.monthly_price`.
- There is no per-client override — a client's billable amount is fully
  determined by the package linked through `projects`.

**Closest existing query**

- `fetchClientsWithRelations()` IS the join. For Phase 4, no new
  query is needed; filter its result with
  `client.type === "brand" && (status === "active" || "onboarding") &&
  pkg !== null && pkg.monthly_price > 0`. `hoursThisMonth` is computed
  in the same function and goes unused for the income suggestion — fine,
  it's cached and amortized across other dashboard widgets.

---

## 2. Calendar Shoots (mileage suggestion source)

**Where the data lives**

- `app/owner/calendar/_lib/queries.ts:53-107` — `fetchEventsInRange(start,
  end)` returns the assembled `CalendarEvent[]` (shoots + time_blocks).
  Phase 4 cares only about shoots, so this isn't quite the right fetcher
  (it intermixes time_blocks). The cleanest Phase-4 query is a fresh
  `shoots` select scoped to the financials month.

**Shoot date + location**

- Date field: `shoots.scheduled_at timestamptz` (UTC instant). For
  "shoots this month" use `gte/lte` on `scheduled_at` against the same
  UTC range Phase 3 builds from `monthRangeForKey()` —
  but be aware Phase 3 currently filters by date-key columns
  (`payment_date`, `date`, `trip_date`), while shoots filter by a
  timestamptz. The TZ math in `app/owner/calendar/_lib/timezone.ts`
  already has `monthRangeForKey` (returns `YYYY-MM-DD` strings); the
  shoots query will need a small bridge that turns those into
  `combineDateAndTimeInTimezone(start, "00:00")` → ISO and likewise for
  the end-of-month + day boundary. Pattern already used in
  `fetchEventsInRange`.

- Location field: **`shoots.location text` is a free-text label, not a
  geocoded address** (`supabase/schema.sql:79`). Real-world values in
  the seed file are things like `"The Glam House Nashville"`,
  `"Harper James Salon"`, `"Re::Creative"`. The actual street address
  used for mileage is **not on the shoot row.** No `clients.address`
  column exists either.

**Where the actual destination address comes from**

- It doesn't, today. The closest analog is `mileage_logs.to_address`
  in the seed (`supabase/seed-financials.sql:43-60`) where the address
  is manually entered as the venue name ("The Glam House Nashville",
  etc.) — i.e. the *name*, not a geocoded street.
- Phase 4 will need to decide: do mileage suggestions copy
  `shoots.location` verbatim into `to_address` (matching how Kelsey
  enters it manually today), or does it require a real street address
  for distance computation? **The Google Distance Matrix accepts text
  place names**, so verbatim copy is workable for both display and
  distance lookup. Worth confirming with Kelsey before building.

**Existing link between a shoot and a mileage_logs row**

- **None.** `mileage_logs` has `client_id` (nullable FK to clients) but
  no `shoot_id`. Reconciliation today is purely visual: same date, same
  client. For Phase 4's "shoots without mileage" strip, the cleanest
  detection rule without a migration is:
  `for each shoot S in this month with kind='shoot' and status in
  ('confirmed','completed'), is there a mileage_logs row M where
  M.trip_date == dateKeyInTimezone(S.scheduled_at) and M.client_id ==
  S.client_id?`
  This will false-negative when Kelsey enters a trip without
  client_id (the `Re::Creative` row in the seed shows this is realistic),
  and false-positive when one trip covers two same-day shoots for the
  same client. Both edge cases are tolerable for a *suggestion* surface.

---

## 3. app_settings

**Confirmed fields** (`supabase/schema.sql:223-234`):
- `home_address text not null default ''` — seeded to
  `'427 Nichol Mill Lane, Franklin, TN 37067'`
  (`supabase/seed-financials.sql:84-86`).
- `mileage_rate_per_mile numeric not null default 0.70`.
- `tax_set_aside_percent numeric not null default 28`.

All three exist. `home_address` is the mileage suggestion's `from_address`
default.

**Server-side helper / caching**

- **There is no `getAppSettings()` helper.** Both readers query Supabase
  directly:
  - `app/owner/financials/_lib/queries.ts:112-117` — reads
    `tax_set_aside_percent`.
  - `app/owner/financials/_actions.ts:335-342` — reads
    `mileage_rate_per_mile`.
- Each call hits the DB fresh — no `cache()` wrapper, no module-level
  memoization. Phase 4 will add a third caller (suggestion computation
  needs `home_address`), making this the right moment to factor a tiny
  shared helper. A `fetchAppSettings()` in `app/owner/financials/_lib/`
  wrapped in React's `cache()` matches the precedent set by
  `fetchClientsWithRelations` (request-scoped, no module-level state).

**Missing-settings handling**

- `queries.ts:128` throws `"app_settings row not found"` if the singleton
  is missing.
- `_actions.ts:341` returns `{ ok: false, error: "App settings missing" }`.
- The seed inserts the row idempotently (`schema.sql:391-393`), so the
  null path should never fire in practice — but the throwing path on the
  page render would 500 the whole financials page. Worth keeping in mind
  if Phase 4 makes suggestion computation depend on a fourth field that
  could realistically be empty (e.g. `home_address`, which **defaults to
  `''` — non-null but unusable for distance**). The mileage suggestion
  needs an explicit `if (home_address.trim() === '') skip` guard, not a
  null check.

---

## 4. recurring_expense_templates

**Table exists** (`supabase/schema.sql:293-308`):
- `id uuid pk`
- `name text not null`
- `category text not null check (...)` — uses the new 6-enum
  (`platform_software`, `marketing_advertising`, `equipment_gear`,
  `travel_transportation`, `professional_services`, `business_operations`)
- `amount numeric not null check (amount > 0)`
- `day_of_month smallint not null default 1 check (between 1 and 28)`
  — the 28 ceiling is deliberate so Feb is safe.
- `notes text`
- `active boolean not null default true`
- `created_at timestamptz`

Index: `recurring_expense_templates_active_idx on (active)`
(`schema.sql:307-308`).

**Seeded rows** (`supabase/seed-financials.sql:14-18`):
| name | category | amount | day | active |
|---|---|---|---|---|
| Pic-Time | platform_software | 10.00 | 1 | true |
| Canva | platform_software | 15.00 | 1 | true |
| iCloud Storage | platform_software | 2.99 | 1 | true |
| Lightroom | platform_software | 6.99 | 1 | true |

All four expected templates present, all on day 1, all active.

**Existing queries against this table**

- **None.** Grep `recurring_expense_templates` across the repo returns
  only `lib/supabase.ts` (type def), `supabase/schema.sql`,
  `supabase/seed-financials.sql`, and the Phase 3a audit doc. No app
  code reads or writes the table yet. Phase 4 will be the first
  consumer.

- The type is already exported as `RecurringExpenseTemplateRecord`
  (`lib/supabase.ts:192-201`) and registered on the `Database` shape
  (`lib/supabase.ts:235-237`), so a new query module gets typed inserts
  and selects with no schema work.

---

## 5. income_payments + mileage_logs + expenses (suggestion destinations)

**Source / auto_generated / FK-back fields**

| Table | Source/auto field | FK to origin | Usable proxy without migration |
|---|---|---|---|
| `income_payments` | none | `client_id` (nullable) | `client_id + payment_date.month + income_type='brand_retainer'` |
| `mileage_logs` | none | `client_id` (nullable) | `client_id + trip_date` (matches shoot date+client) |
| `expenses` | none | none | `description + date.month` text match against template `name` |

None of the three tables has a `source`, `auto_generated`, `origin`, or
template/shoot FK. Reverse-detection of "this suggestion is already
satisfied" must be done by data shape, not by a marker column. Per
table:

- **Income (brand-retainer suggestion)**: "satisfied" =
  `exists income_payments where client_id == suggestion.clientId AND
  income_type == 'brand_retainer' AND payment_date in [month.start,
  month.end]`. The Phase 3a action defaults `client_id = null` on
  inserts (`_actions.ts:79`); Phase 4's accept-suggestion action needs
  to insert with the *resolved* `client_id` so future months can
  detect it.

- **Mileage (per-shoot suggestion)**: "satisfied" = see Section 2's
  rule. Works with current shape.

- **Expense (recurring-template suggestion)**: "satisfied" =
  `exists expenses where description == template.name AND
  date.month == suggestion.monthKey`. Brittle on rename ("Canva" →
  "Canva Pro" breaks detection), but tolerable for a suggestion
  surface. The DB has no template_id column on expenses.

**Migration option (cleanest, optional)**

Adding nullable origin/source columns would simplify reconciliation
forever and cost essentially nothing:

```sql
alter table income_payments add column if not exists
  source text check (source in ('manual','suggested_retainer'));
alter table mileage_logs add column if not exists
  source_shoot_id uuid references shoots(id) on delete set null;
alter table expenses add column if not exists
  source_template_id uuid references recurring_expense_templates(id) on delete set null;
```

Worth doing — see "Migrations needed" section below.

**Phase 3a/3b action shape (template for accept-suggestion actions)**

The canonical create-action shape, from
`app/owner/financials/_actions.ts:57-96` (`addIncomePaymentAction`):

```ts
interface ActionResult<T = null> {
  ok: boolean;
  error?: string;
  data?: T;
}

export async function addIncomePaymentAction(
  input: AddIncomePaymentInput
): Promise<ActionResult<IncomePaymentRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  // …validate…
  const { data, error } = await supabase
    .from("income_payments")
    .insert({ /* …, logged_by: guard.ownerLabel */ })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "…" };
  revalidatePath("/owner/financials");
  return { ok: true, data: data as IncomePaymentRecord };
}
```

The `addExpenseAction` and `addMileageLogAction` companions sit in the
same file at `:194-228` and `:316-366`. **Phase 4's accept-suggestion
actions should mirror this exactly** — same `ActionResult<T>` envelope,
same `requireOwner()` guard, same `revalidatePath("/owner/financials")`.
For acceptance flows, the action takes the pre-resolved suggestion
payload (i.e. the client component already knows the values), so input
shape is identical to the existing `Add*Input` types but the action
optionally also writes the `source`/`source_*_id` column from §5's
proposed migration.

Where to put them: either extend `_actions.ts` (current file is already
443 lines, getting long) or split out a `_actions/suggestions.ts`.
Existing convention is one `_actions.ts` per route — staying with that
is fine.

---

## 6. The financials page itself

**Page shape** (`app/owner/financials/page.tsx`):

- Server component (`export const dynamic = "force-dynamic"`).
- Reads `month` / `range` from searchParams (URL contract documented in
  the page header comment).
- Fetches **all three tables + app_settings in one `Promise.all`** via
  `fetchFinancialsForRange(range)` at `_lib/queries.ts:81-251`. Note:
  this is the right shape for Phase 4 to slot into — add the suggestion
  computation as additional parallel queries or as a follow-up
  `await` after `fetchFinancialsForRange` resolves.
- Hands the data to `<FinancialsBoard initial={…} taxRatePercent={n}
  summaryEyebrow={…} />` — a `"use client"` wrapper at
  `_components/FinancialsBoard.tsx`.

**Ghost row location** (per-table):

- Income: `IncomeTable.tsx:155-235` — single `<tr>` keyed by
  `draftKey`, identical column layout to a real row but every `<td>`
  is an `<InlineCell>` with placeholder text (`"Add date…"`,
  `"Add client…"`, `"$0"`, etc.). Persists until all required fields
  are filled, then `onDraftFieldChange` autosubmits.
- Expense: `ExpenseTable.tsx` mirrors the same shape.
- Mileage: `MileageTable.tsx:144-229` — same shape. Rate/deduction/
  client cells are `—` em-dashes (read-only in the draft).
- The visual differentiator from a "real" row is **inline placeholder
  text** in the cells (italic, `var(--text-muted)`). Phase 4's
  suggestion rows need a third visual treatment — placeholders are
  taken, real-row look is taken. The cleanest cue: tint the row
  background (e.g. very subtle accent tint) plus replace the trailing
  delete-x button area with `[✓] [✗]` buttons.

**State ownership**

- `FinancialsBoard.tsx` is the single source of truth client-side. It
  holds:
  - `incomeRows / expenseRows / mileageRows` (live arrays, mutated on
    edit/delete/accept).
  - Per-table `draft` + `draftKey` + `draftSaving` + `draftError`.
  - Recomputes `summary` via `recomputeSummary()` at lines 141-165 —
    **must keep this formula bit-identical to `queries.ts:229-235`**.
- Suggestion state will need new top-level state slots —
  `incomeSuggestions / expenseSuggestions / mileageSuggestions` arrays
  plus the local `dismissed` set. Accepting a suggestion = `setRows`
  with the new server-returned row + removing the suggestion from its
  array.

**Server-side data fetched on page load**

- `income_payments` (range-filtered).
- `expenses` (range-filtered).
- `mileage_logs` (range-filtered) + a follow-up `clients(id, name)`
  lookup for the mileage client names.
- `app_settings.tax_set_aside_percent`.

Phase 4 adds, on top of this, in parallel:
- `clients + projects + packages` (via existing
  `fetchClientsWithRelations()`) — for income suggestions.
- `shoots` for the range — for mileage suggestions.
- `recurring_expense_templates where active = true` — for expense
  suggestions.
- `home_address` + `mileage_rate_per_mile` from app_settings (merge
  with the existing tax-rate query into one settings fetch via the
  helper proposed in §3).
- Per-suggestion "is it already satisfied?" checks (see §5) — these
  can fold into the existing range fetches since the data is already
  there.

---

## 7. Dismissal state

**Search results**: grep for `dismiss`, `snooze`, `hidden`, `dismissed_*`,
`suggestion` across the repo returned:
- `ConfirmDialog.tsx:9` — JSDoc reference to "dismisses the dialog" (UX
  only, irrelevant).
- `useVisibilityPolling.ts`, `MessageThread.tsx`, `WeekView.tsx` etc. —
  all CSS `hidden` / DOM visibility, irrelevant.
- `dismissed_suggestions` table — **not present**.
- `suggestion` — **zero matches** in source code.

**Nothing tracks dismissed-X-for-period-Y today.** Phase 4 is the first
consumer. Lightweight model options:

**Option A — `dismissed_suggestions` table**:
```sql
create table if not exists dismissed_suggestions (
  id              uuid primary key default gen_random_uuid(),
  type            text not null check (type in (
                    'income_retainer',
                    'mileage_shoot',
                    'expense_template'
                  )),
  reference_id   uuid not null,       -- clientId | shootId | templateId
  period_yyyymm  text not null,       -- '2026-05'
  dismissed_at   timestamptz not null default now(),
  unique (type, reference_id, period_yyyymm)
);
```

**Option B — JSON column on `app_settings`**:
```sql
alter table app_settings add column if not exists
  dismissed_suggestions jsonb not null default '[]';
-- shape: [{ type, reference_id, period_yyyymm }]
```

**Recommendation: Option A.** Three reasons:
1. The set grows unboundedly over time (every month, a few dismissals)
   — JSON in a singleton row is fine at 100 entries but cumbersome at
   10,000.
2. The unique constraint enforces idempotency on the dismiss action
   for free; JSON would need read-modify-write with race risk.
3. Phase 4 will query "is X dismissed for month M?" frequently per
   page load (N suggestions per page). A two-column index lookup is
   faster and clearer than scanning a JSON array.

Tradeoff: one more table. Worth it for the data-modeling clarity.

---

## 8. Distance Matrix API

**Existing maps / distance code**

- `lib/google-maps.ts` — **does not exist**.
- `app/_lib/distance.ts` — does not exist.
- Grep for `google` / `maps` / `distance` in source:
  - `MessageThread.tsx:329` — `distance` is scroll-position math.
  - `lib/messageEmails.ts:30`, `app/api/invite/route.ts:60`,
    `app/layout.tsx:2` — `fonts.googleapis.com` / Google Fonts only.
  - No Distance Matrix, no Maps SDK, no `@googlemaps/*` import
    anywhere.

**`GOOGLE_MAPS_API_KEY` referenced in code**: **none.** Searched
`*.ts,tsx,js,jsx,md`, no hits.

**HOWEVER** — `.env.local` (line 16) already contains
`GOOGLE_MAPS_API_KEY=AIzaSyB…`. The key is provisioned but unused.
Phase 4 should:
- Verify which Google APIs the key is enabled for (Distance Matrix vs
  legacy Places vs new Routes API). The audit's read-only scope can't
  test this; flag it as a setup step.
- Add the key to `.env.local.example` so it's documented for
  future-Kelsey / future-Claude sessions.
- Read it server-side only (never `NEXT_PUBLIC_*`-prefix); use the same
  `requireEnv()` pattern at `lib/supabase.ts:247-252`.

**Where the new module should live**

Consistent with existing conventions, the choice is between:
- `lib/google-maps.ts` — sibling to `lib/supabase.ts`, `lib/clerk.ts`,
  `lib/messageEmails.ts`. **Pick this one.** The other `lib/*` files
  are exactly this shape: thin third-party wrappers consumed by
  server-side modules. The financials feature is one of multiple
  potential consumers (e.g. a future "drive time" widget on the
  calendar could share it), and `lib/` is where cross-feature helpers
  go.
- `app/owner/financials/_lib/distance.ts` — feature-local. Fine if
  Phase 4 is the only consumer ever, but `lib/` is more honest about
  the scope.

The Phase 4 build should:
- Expose `getMilesBetween(from: string, to: string): Promise<number>`
  (or whatever shape — keep it minimal).
- Cache aggressively in-memory per server lifetime (Distance Matrix
  charges per request, results are deterministic for static endpoints).
  Vercel serverless = cold cache per invocation, so consider whether
  the cache should live in Supabase as a `distance_cache (from, to,
  miles)` table. **Out of scope for this audit; flag as an open
  question.**

---

## Migrations needed before Phase 4 code

Pragmatic minimum (all idempotent, all small):

1. **`dismissed_suggestions` table** — required. See §7 Option A.
2. **Origin/source columns on the three destination tables** — strongly
   recommended (see §5). Skipping these means Phase 4 reconciliation is
   text-match / date-match fuzzy, which works but rots over time.
   ```sql
   alter table income_payments add column if not exists
     source text check (source in ('manual','suggested_retainer'));
   alter table mileage_logs add column if not exists
     source_shoot_id uuid references shoots(id) on delete set null;
   alter table expenses add column if not exists
     source_template_id uuid references recurring_expense_templates(id)
       on delete set null;
   ```
   Existing rows get NULL on the new columns and are implicitly treated
   as `'manual'` — no backfill required.

Optional / deferred:
- **`distance_cache` table** — if Distance Matrix cost or latency
  becomes an issue. Don't pre-build.

No schema changes are needed to ship a working Phase 4 if you accept
fuzzy reconciliation; the origin columns are an investment in long-term
sanity.

---

## Risks / open questions

1. **`shoots.location` is a free-text venue name, not a street
   address.** Distance Matrix accepts both ("The Glam House
   Nashville" probably geocodes correctly in Nashville context), but
   results will be inconsistent. Confirm with Kelsey: does she want
   the suggestion to *propose* a `to_address` (which she can edit) or
   to *auto-fill and submit*? The plan says "✓ to accept" — that
   implies one-tap, no edit, which raises the bar on the distance
   lookup's accuracy.

2. **`home_address` defaults to `''`**. The seed file sets it to a real
   address, but a fresh greenfield install would have empty string. The
   mileage suggestion needs an explicit `home_address.trim() !== ''`
   guard before computing distance. Page should not 500.

3. **No FK between mileage_logs and shoots today** — reconciliation
   without the migration in §5 is heuristic (same date + same client_id).
   False-negative on null-client trips (the `Re::Creative` seed row);
   false-positive when one trip covers two same-day same-client
   shoots. Acceptable for a suggestion surface; documented here so
   nobody is surprised.

4. **`fetchClientsWithRelations` does a `clients.*` `select`** plus
   joins. Phase 4 doesn't need every column (just `id, name, type,
   status, projects.package_id, packages.monthly_price`). Reusing the
   existing cache-wrapped function is correct (request-scoped, shared
   with dashboard widgets); resist the urge to add a narrower
   `fetchActiveBrandRetainers()` until profiling shows a problem.

5. **GOOGLE_MAPS_API_KEY is already in `.env.local` but not in
   `.env.local.example`.** Means the env is set on Tanner's box but
   not documented. Phase 4 should update the example file as a
   build-time chore.

6. **The Distance Matrix API has billing implications.** Free tier is
   ~$200/month of credits at the time of writing, which covers
   thousands of lookups, but every page render of `/owner/financials`
   would re-resolve every shoot's distance unless cached. Caching
   strategy needs to be decided before code (in-memory? Supabase
   table? Resolve once at accept-time and never again?). Suggest:
   resolve at accept-time only — the ghost suggestion can display
   "approx X mi" using a heuristic (zip code distance?) or omit the
   miles entirely, and the real distance lookup happens when Kelsey
   clicks ✓.

7. **`isValidDateKey` and `isPositiveFiniteNumber` validation
   helpers are duplicated** in `_actions.ts` rather than centralized.
   Phase 4 actions will duplicate them again. Not a Phase-4 blocker
   but worth a tiny cleanup pass (factor to `_lib/validation.ts`)
   while the file is open.

8. **`app_settings` has no shared read helper** (see §3). Phase 4 is
   the third place this gets read; factor a `fetchAppSettings()` in
   `app/owner/financials/_lib/queries.ts` wrapped in `cache()` while
   you're there.

9. **No `useOptimistic` precedent.** The existing
   pattern is `useTransition` + snapshot ref (per Phase 3a audit
   Section B). Phase 4 should stick with it for accept/dismiss
   handlers.

10. **Mileage suggestion needs the clients map at the
    `<FinancialsBoard>` level**, not just at the mileage table —
    Phase 3a already noted this gap (Phase 3a audit Risk #2). If the
    accept-mileage-suggestion action writes `client_id`, the row
    coming back needs name resolution either via a second query in the
    accept action or via a clients map threaded through the
    `FinancialsBoard` props.
