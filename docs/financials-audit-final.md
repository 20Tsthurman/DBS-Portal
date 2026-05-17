# Financials Audit — Final (Phases 1–4)

Read-only audit of the entire `/owner/financials` module after Phase 4
(suggestions). Cited at file:line; no code modified. Pre-build assumptions
from `docs/financials-phase-4-audit.md` are used as the baseline.

Severity legend: **[CRITICAL]** data integrity / wrong-number risk ·
**[IMPORTANT]** UX-degrading or rot-prone bug, no data risk ·
**[NIT]** style/clarity/consistency · **[DEAD-CODE]** unreachable /
superseded / leftover scaffolding.

---

## 1. Dead Code & Unused Exports

- **[DEAD-CODE]** `app/owner/financials/_components/FinancialsBoard.tsx:196-199`
  — the `monthKey` prop is renamed to `_monthKey` and immediately
  `void`-referenced with the comment *"monthKey is unused in Step 5 —
  Step 6's dismiss action will consume it."* Step 6 in fact never
  consumed it: the dismiss handlers use `sug.periodYyyymm` instead
  (lines 586, 641, 702). The prop is genuinely unused; the
  underscore-rename + `void` was Step-4 scaffolding that Step 7 was
  supposed to remove. Either delete the prop and drop `monthKey={…}` at
  `page.tsx:168`, or wire `_monthKey` into the dismiss payloads in
  place of `sug.periodYyyymm` (single source of truth instead of one
  copy per suggestion). The cleanup pass missed this entire chunk.

- **[DEAD-CODE]** `FinancialsBoard.tsx:22` and `:45` define two local
  type aliases with identical shape:
  `type SugResult = { ok: boolean; error?: string };` and
  `type CommitResult = { ok: boolean; error?: string };`. Only one is
  needed. The same shape is also re-declared at
  `IncomeTable.tsx:14`, `ExpenseTable.tsx:14`,
  `MileageTable.tsx:11`, and `InlineCell.tsx:17`. Six identical
  declarations is well past the "rule of three." Factor to a shared
  module (`_lib/types.ts` or just lift one of the existing local ones
  into `_components/`) and import.

- **[DEAD-CODE]** `FinancialsBoard.tsx:132-140` — three identical
  sort helpers (`sortIncome`, `sortExpense`, `sortMileage`) that only
  compare by the `date` string. Collapse to one
  `sortByDateDesc<T extends { date: string }>(rows: T[])` helper.

- **[DEAD-CODE]** `sugInFlight` Set + `setInFlight` machinery in
  `IncomeTable.tsx:70,97-104` and `ExpenseTable.tsx:66,91-98` is
  effectively unreachable for the user. The corresponding board
  handlers (`handleIncomeSuggestionAccept` at
  `FinancialsBoard.tsx:543-577` and
  `handleExpenseSuggestionAccept` at `:600-632`) optimistically
  remove the suggestion from `…SugState` *before* awaiting the
  action. By the time the `await` resolves and the table-level
  `setInFlight(refId, false)` runs, the row has already unmounted —
  no `disabled={inFlight}` ever applies to a visible button. Only
  `MileageTable.tsx`'s use of the same primitive is load-bearing
  (the mileage handler intentionally defers removal so "Calculating…"
  can render). Either delete the Set tracking in the two non-mileage
  tables, or move the "wait to remove" treatment up so all three
  tables behave consistently.

- **[NIT]** `FinancialsBoard.tsx:148-151` JSDoc says *"Wired into the
  three table components in Step 5."* — stale build-step language;
  Phase 4 has shipped.

- **[NIT]** `FinancialsBoard.tsx:204-208` references Phase 4 in a
  comment as if narrating implementation; readable but stylistically
  drifts from the rest of the codebase's prose. Same for the
  `/* Phase 4 — suggestion ghost rows. */` comment in the
  `<style>` block at `:930`.

- **[NIT]** `_lib/suggestions.ts:34` comment refers to "Step 6"
  (`// as referenceId so the accept/dismiss actions in Step 6 can
  route by it.`). Stale build-step language.

---

## 2. Type Safety & Drift

- **[IMPORTANT]** `IncomeTable.tsx:178-182` and `:247-251`,
  `ExpenseTable.tsx:166-173` and `:236-240`: enum `<InlineCell>`s
  cast `(v ?? "<fallback>")` to the target enum on commit. For
  existing rows the fallback is `""`, which the server action will
  always reject (`!INCOME_TYPES.includes("")`), surfacing as a
  rollback. For suggestion rows the fallback is the silent default
  `"other"` (income) or `"business_operations"` (expense), which
  *would* corrupt the staged suggestion if `v` were ever `null` — i.e.
  if the user could clear the select. In practice the select can't be
  cleared because there's no empty placeholder option for non-null
  values, so the path doesn't fire. Still: an `as` cast that swallows
  `null` is a brittle pattern. Prefer guarding the call site (skip
  commit when `v === null`) over a silent default.

- **[NIT]** `IncomeSuggestion.incomeType` (`_lib/suggestions.ts:47`)
  is widened from the literal `"brand_retainer"` to the full
  `IncomeType` union specifically so the suggestion row's type
  dropdown (`IncomeTable.tsx:241-253`) can edit it before accept.
  Used downstream — not vestigial. The JSDoc at `:42-46` explains
  this clearly. ✓ (No finding; called out because the audit prompt
  asked.)

- **[NIT]** `_actions.ts:184`, `:236`, `:375`, `:683` cast Supabase
  `.single()` returns with `data as IncomePaymentRecord` etc. The
  Supabase typegen would obviate the cast, but the existing codebase
  uniformly hand-rolls record types (`lib/supabase.ts`) and casts at
  the boundary. Consistent with the rest of the portal; no
  Phase-4-specific finding.

- **[NIT]** `_actions.ts:124,255,394` use
  `const patch: Record<string, unknown> = {};` rather than a typed
  partial. Existing pattern in `app/owner/shoots/_actions.ts` and
  `app/owner/calendar/_actions.ts`. Consistent.

- **[NIT]** `_lib/suggestions.ts:108-109` —
  `export type DismissedKey = \`${DismissedSuggestionRecord["type"]}:${string}\`;`
  is a nicely-typed template literal but `${string}` adds no real
  guarantee beyond `string`. Cosmetic. Keep.

---

## 3. Validation Consistency

- **[IMPORTANT]** `isValidDateKey` and `isPositiveFiniteNumber` at
  `_actions.ts:45-51` are flagged in the Phase 4 audit (Risk 7) as
  worth factoring. Phase 4 used them 10× more (every accept/update
  action) and the duplication is now significant. `isValidDate` in
  `app/owner/calendar/_actions.ts:38-41` is functionally the same
  regex check under a different name. **Proposed location:**
  `lib/validation.ts` (new, sibling of `lib/csv.ts`, `lib/auth.ts`).
  Export `isValidDateKey(s: unknown): s is string` and
  `isPositiveFiniteNumber(n: unknown): n is number`. Update calendar
  to import the same helpers. Single ~12-line file, no behavior
  change.

- **[NIT]** `_actions.ts:713` validates `period_yyyymm` with
  `/^\d{4}-\d{2}$/` but doesn't bound the month to 1–12. A payload
  of `2026-99` would pass JS and reach the DB. The DB CHECK at
  `supabase/migrations/001_phase4_suggestions.sql:36` has the same
  gap (it's the same regex). Mild defense-in-depth concern; the
  values come from server-rendered `periodYyyymm` so a malicious
  injection is unlikely. Add a numeric range check for symmetry
  with `page.tsx:58-62`'s `isValidMonthKey`, OR re-use that helper
  (it lives only in `page.tsx` today — moving to `lib/validation.ts`
  alongside the date helpers would consolidate all three).

- **[NIT]** Manual entry vs. suggestion-accept paths enforce the
  same rules:
  - amount > 0 enforced in all three add/accept paths
    (`_actions.ts:77,215,490,552`).
  - date format enforced in all (`_actions.ts:72,209,331,482,546,609`).
  - enum membership enforced (income_type, category).
  - All four `accept*` actions plus four `add*` actions go through
    `requireOwner()` and `revalidatePath("/owner/financials")` —
    consistent.
  - `acceptIncomeSuggestionAction` adds `client_id` required;
    `addIncomePayment` leaves `client_id` null. Asymmetric on
    purpose (Phase 4 §5).
  - `acceptExpenseSuggestionAction` adds `source_template_id`
    required; `addExpense` doesn't write it. Symmetric to the
    above.
  - `acceptMileageSuggestionAction` adds `source_shoot_id`
    required and computes miles via Distance Matrix; `addMileageLog`
    trusts the typed miles. Symmetric.

- **[NIT]** `_actions.ts:215` checks `amount > 0` in TS for
  expense inserts but the DB has no CHECK on `expenses.amount`
  (schema.sql:143 declares it `numeric not null` with no positivity
  constraint). Pre-existing gap flagged in
  `docs/expenses-pre-build-audit.md` §12 and the Phase 3a audit
  §I.6. Phase 4 doesn't introduce the gap; mention only because
  the topic surfaces here. Adding `check (amount > 0)` to the
  expenses table is a one-liner migration and would let the
  client validation degrade gracefully if someone bypasses it.

- **[NIT]** `_actions.ts:646` re-rounds doubled mileage to one
  decimal even though `getMilesBetween` already returns a
  one-decimal number; the inline comment at `:642-645` is honest
  about it being defensive. Fine.

---

## 4. Error Handling & Edge Cases

- **[IMPORTANT]** Stale-state duplication: page open for an hour →
  Kelsey logs the same retainer manually in another tab → clicks ✓
  on the now-stale suggestion. `acceptIncomeSuggestionAction`
  (`_actions.ts:476-522`) has no uniqueness check; it inserts a
  second `income_payments` row with the same `client_id`, same
  month, same amount. The duplicate appears in the table after the
  client-side sort and silently doubles "Total Income" on the
  Summary card. Per the Phase 4 audit §5 the only suppression
  signal is data shape — the action has all the info it needs to
  re-run that check at write time but doesn't. Same pattern for
  `acceptExpenseSuggestionAction` (description fuzzy match) and
  `acceptMileageSuggestionAction` (shoot-FK or date+client). A
  cheap defense: re-check satisfaction inside each accept action
  before insert and short-circuit with a friendly "Already logged
  this month" error. Lowest priority of the IMPORTANTs because the
  user can see and delete the dup — but it's the failure mode most
  likely to bite in real use given Kelsey toggles between
  spreadsheet and portal.

- **[IMPORTANT]** Shoot deleted between page load and ✓ on its
  mileage suggestion: `mileage_logs.source_shoot_id` is `on delete
  set null` (migration 001:65), so the FK constraint will REJECT
  the insert with a foreign-key-violation error (no row exists to
  set-null *from*). The error bubbles to the UI via the generic
  `sugError` banner showing the raw Postgres message — confusing
  but recoverable. Consider catching `error.code === "23503"` and
  surfacing "This shoot was deleted — refresh the page." Not
  blocking.

- **[NIT]** Distance Matrix failure modes: `getMilesBetween`
  (`lib/google-maps.ts:56-92`) throws on five distinct conditions.
  All five are caught by `acceptMileageSuggestionAction`'s
  try/catch at `_actions.ts:632-639`, which collapses them into a
  single user-facing string. Good for Kelsey, bad for debugging
  (no `console.error` of the specific cause). Add a server-side
  `console.error(err)` inside the catch so the underlying message
  reaches Vercel logs.

- **[NIT]** Distance Matrix returns `0` for adjacent addresses;
  guarded at `_actions.ts:650-655` (doubled-zero is still zero
  which fails `isPositiveFiniteNumber`, surfacing the same fallback
  message). ✓

- **[NIT]** Rapid double-click on ✓/✗ during in-flight action:
  - Income/expense: `if (sugInFlight.has(sug.referenceId)) return;`
    in the table's `handleAccept`/`handleDismiss`
    (`IncomeTable.tsx:106-117`,
    `ExpenseTable.tsx:100-111`). But (per §1 above) the row is
    already removed from `…SugState` before the await, so the
    second click can't reach those buttons. Defense-in-depth.
  - Mileage: same `sugInFlight` check; row stays visible during
    Distance Matrix call (`MileageTable.tsx:266-296` conditionally
    renders "Calculating…" with no buttons). Cannot double-click. ✓

- **[NIT]** `dismissSuggestionAction` uses `.upsert(...)` with
  `ignoreDuplicates: true` and `onConflict:
  "type,reference_id,period_yyyymm"` (`_actions.ts:720-730`). Combined
  with the unique constraint at migration 001:38-40 this is
  correctly idempotent — re-dismiss returns `ok: true` with no
  insert. ✓

- **[NIT]** `acceptMileageSuggestionAction` does not retry the
  Distance Matrix call. One transient network failure → user sees
  the error → can click ✓ again. Acceptable; Kelsey can tell the
  difference between "transient" and "permanent" easily enough.

---

## 5. Suppression Correctness

Verified against the Phase 4 audit's stated rules:

- **Income (`computeIncomeSuggestions`,
  `_lib/suggestions.ts:129-172`)**: filters by
  `r.client.type === "brand"` AND
  `r.client.status === "active" || "onboarding"` AND `r.pkg !==
  null` AND `pkg.monthly_price > 0` (`:135-142`). Matches the
  Phase 4 audit's recommendation derived from `BudgetStatusWidget`.
  Suppression: any `income_payments` row with the suggestion's
  `client_id` AND `income_type === "brand_retainer"` AND
  `payment_date.startsWith(monthKey)` (`:146-151`). Correct. ✓

- **Expense (`computeExpenseSuggestions`, `:191-228`)**: FK-based
  suppression takes priority — `if (e.source_template_id) …` (`:201`)
  builds `satisfiedByFk`; the *else-if* falls back to
  case-insensitive name match (`:203-205`). Then BOTH sets are
  checked (`:211-212`). Belt-and-suspenders: a single expense
  contributes to one bucket but a suggestion is suppressed if
  EITHER bucket has it. ✓
  - **[NIT]** Pre-existing rows from before Phase 4 have
    `source_template_id = NULL` and rely on the name fallback. A
    rename ("Canva" → "Canva Pro") in `recurring_expense_templates`
    will silently re-surface a suggestion that Kelsey already paid.
    Per spec, tolerable. Worth a one-line code comment near
    `:203-205` explaining the rot path so a future reader doesn't
    have to derive it.

- **Mileage (`computeMileageSuggestions`, `:255-303`)**:
  - `s.kind !== "shoot"` excludes meetings (`:279`). ✓
  - `s.status === "cancelled"` excluded (`:280`). ✓
  - `startMs >= nowMs` filtered — only past shoots (`:282`). ✓
  - `!s.location || s.location.trim() === ""` excluded (`:283`).
    Good — Distance Matrix needs a destination.
  - FK match via `source_shoot_id` (`:285`); fallback to
    `(trip_date, client_id)` (`:287`). ✓
  - `dismissed.has(...)` checked (`:288`). ✓
  - **[CRITICAL]** *The compute function does NOT verify that the
    derived `tripDate` falls inside `monthKey`.* The orchestrator
    deliberately widens the shoots query by ±1 day in UTC
    (`suggestions.ts:332-338`) so that a Central-evening shoot at
    the month boundary isn't missed. The widening comment claims
    parity with `app/owner/calendar/_lib/queries.ts:59-61`, but
    the calendar code *re-narrows* in JS after assembling startsAt
    (`fetchEventsInRange:101-103` filters out events whose UTC
    interval falls outside `[start, end)`). The financials compute
    function omits this re-narrowing — see "Date / Timezone
    handling" §8 below for the full cascade.

- **`home_address.trim() === ""` guard** at `:264`: fires
  unconditionally before any per-shoot work; greenfield install
  (no home_address yet) produces an empty mileage suggestion
  list rather than throwing. ✓

- **`dismissed_suggestions` page-load filter** at
  `suggestions.ts:362-364`: keyed by `eq("period_yyyymm",
  monthKey)`. monthKey format is consistent throughout
  (`YYYY-MM`, never a leading/trailing space). The
  `DismissedKey` set construction at `:395-399` uses
  `${type}:${reference_id}`. Compute functions check
  `dismissed.has('expense_template:${t.id}')` etc.
  (`:157,213,288`). Format match. No off-by-one. ✓

---

## 6. State Management in FinancialsBoard

- **[IMPORTANT]** `sugDrafts` Map in each table
  (`IncomeTable.tsx:67-69`, `ExpenseTable.tsx:63-65`,
  `MileageTable.tsx:56-58`) accumulates a per-`referenceId` entry on
  every `patchDraft(...)` call. On accept/dismiss success the
  suggestion is removed from `suggestions` but the matching entry in
  `sugDrafts` is never deleted. Within a single page session,
  accept-then-(silently)-leak. Reset on board remount via the
  `key={…}` prop in `page.tsx:159` — so impact is bounded to one
  month-render. Low-magnitude leak; fix is a `setSugDrafts((m) => {
  const n = new Map(m); n.delete(sug.referenceId); return n; })`
  inside the success branch of each accept/dismiss callback.

- **`recomputeSummary` memo deps** at `FinancialsBoard.tsx:244` —
  `[incomeRows, expenseRows, mileageRows, taxRatePercent]`. Covers
  every input the function reads. ✓

- **Bit-identical formula vs `queries.ts:241-247`**:
  - Server (`queries.ts:241-247`):
    `income = Σ amount`,
    `expensesFromTable = Σ amount`,
    `mileageDeduction = Σ deduction` where `deduction = miles *
    rate_per_mile` (computed in `queries.ts:233`),
    `expenses = expensesFromTable + mileageDeduction`,
    `netProfit = income − expenses`,
    `taxSetAside = netProfit > 0 ? netProfit * (taxRatePercent /
    100) : 0`,
    `takeHome = netProfit − taxSetAside`.
  - Client (`FinancialsBoard.tsx:167-184`): identical, except it
    re-derives the mileage deduction from `r.miles * r.ratePerMile`
    inline (`:170-172`) rather than trusting `r.deduction`. The two
    expressions equal each other in the row construction
    (`queries.ts:233` returns `miles * ratePerMile` for `deduction`),
    so the result is the same. ✓ No drift.

- **Snapshot-and-restore symmetry across the 6 suggestion handlers**:
  - Income accept/dismiss (`:543-577`, `:578-598`): optimistic
    remove → action → restore on failure. ✓
  - Expense accept/dismiss (`:600-632`, `:633-653`): same. ✓
  - Mileage **dismiss** (`:694-714`): same. ✓
  - Mileage **accept** (`:655-693`): NO optimistic remove. Waits
    for the response; removes only on success (`:674-676`). The
    in-code comment at `:657-662` explains the "Calculating…"
    requirement. Intentional asymmetry; symmetric on failure (no
    restore needed because nothing was removed). ✓

- **`monthKey` prop** at `FinancialsBoard.tsx:156,168,196-199`:
  unused as flagged in §1. The dismiss handlers read
  `sug.periodYyyymm` instead — three slightly less-cohesive
  sources of truth (the prop, the suggestion, the URL). Either
  remove the prop or consume it in place of the per-suggestion
  field.

- **Initial-prop drift hazard**: `setIncomeSugState(incomeSuggestions)`
  at `:209` initialises from the prop once and never re-syncs. If
  the page's `key={…}` were ever removed, navigating between
  months would not refresh suggestions. The current `key` strategy
  saves it. No finding; flagged because brittle if the page key
  is touched in a future refactor.

---

## 7. Server Actions

- **Phase 4 actions match ActionResult<T> contract**: all four
  (`acceptIncomeSuggestionAction`, `acceptExpenseSuggestionAction`,
  `acceptMileageSuggestionAction`, `dismissSuggestionAction`) return
  the same `{ ok, error?, data? }` envelope as the Phase 3a/3b
  actions. ✓

- **All call `requireOwner()` and `revalidatePath("/owner/financials")`**:
  - acceptIncome: `:479`, `:520`. ✓
  - acceptExpense: `:543`, `:579`. ✓
  - acceptMileage: `:606`, `:682`. ✓
  - dismiss: `:704`, `:733`. ✓

- **Mileage accept round-trip doubling**: applied at `:646`
  (`miles = Math.round(miles * 2 * 10) / 10;`), comment at
  `:640-645` explains *why*. ✓ Manual `addMileageLogAction`
  trusts the typed `miles` and does NOT double (`:357-369`). The
  manual action has **no comment** explaining the asymmetry —
  a Kelsey-reading-her-own-code future-her could plausibly think
  "manual is missing the doubling, that's a bug" and add it,
  silently doubling every manual entry. Add a one-line comment in
  `addMileageLogAction` near the insert: *"Trust the typed
  value — round-trip doubling only applies to Distance Matrix
  lookups (see acceptMileageSuggestionAction)."*

- **Duplicate logic**: `addMileageLogAction` (`:325-376`) and
  `acceptMileageSuggestionAction` (`:603-684`) both call
  `fetchAppSettings()`, both coerce `mileage_rate_per_mile` to
  `Number()`, both stamp `logged_by: guard.ownerLabel`, both
  insert with `client_id`/`start_odometer`/`end_odometer`/`notes`
  in roughly the same shape. The accept variant additionally sets
  `source_shoot_id` and resolves `miles` via DM. The two action
  bodies share ~25 lines of boilerplate. A
  `buildMileageLogInsert(input, ratePerMile, ownerLabel, extras?)`
  helper would absorb the duplication; not blocking, and lifting it
  diverges from the Phase 3a precedent of one-action-per-table
  with inline inserts. Defer.

- **`acceptIncomeSuggestionAction` requires `client_id`** at `:485`
  but the same payload could theoretically be sent with
  `client_id: ""` (the call site at `FinancialsBoard.tsx:550`
  passes `sug.clientId` which is always populated, so the guard
  works in practice). Defensive. ✓

---

## 8. Date / Timezone Handling

- **[CRITICAL]** Mileage suggestion month-bucketing bug. The
  orchestrator widens the shoots query by ±1 day in UTC
  (`_lib/suggestions.ts:332-338`) with the comment *"same trick
  used in app/owner/calendar/_lib/queries.ts:59-61"* — but the
  calendar code re-narrows after assembly
  (`calendar/_lib/queries.ts:101-103`), and **the financials
  compute function does not**. Cascade:
  1. May render asks for shoots with `scheduled_at` in
     `[2026-04-30T00:00:00.000Z, 2026-06-02T00:00:00.000Z)`.
  2. A shoot at `2026-04-29T20:00:00-05:00` (Apr 29 8pm CDT =
     Apr 30 01:00 UTC) is included.
  3. `computeMileageSuggestions` (`:255-303`) computes
     `tripDate = dateKeyInTimezone(...)` → `"2026-04-29"`.
  4. There is no `if (!tripDate.startsWith(monthKey)) continue;`
     guard. The shoot is pushed as a *May* suggestion with
     `tripDate: "2026-04-29"`, `periodYyyymm: "2026-05"`.
  5. Kelsey clicks ✓. `acceptMileageSuggestionAction` inserts a
     `mileage_logs` row with `trip_date = "2026-04-29"` and
     `source_shoot_id` = that shoot's id.
  6. The April-29 row does NOT appear in May's mileage table
     (`queries.ts:131-132` filters by `trip_date` in
     `[2026-05-01, 2026-05-31]`).
  7. Next May render: the `existingMileageLogs` query
     (`suggestions.ts:376-379`) is also bounded to May → the
     April-29 row is not in `satisfiedByFk`. The shoot
     **re-appears** as a May suggestion. Click again → duplicate
     mileage_logs insert.

  Mitigation that should land before Phase 5: add
  `if (!tripDate.startsWith(monthKey)) continue;` after the
  `dateKeyInTimezone(...)` call (`suggestions.ts:286`). One line,
  zero behavior change in non-edge cases. The widening can stay
  (its purpose is to make sure no edge-of-month shoot is
  *missed*); the new guard ensures the edge shoot is attributed
  to the correct month.

- **Income / expense suppression by month-prefix**
  (`suggestions.ts:149`, `:200`) uses
  `payment_date.startsWith(monthKey)` and
  `e.date.startsWith(monthKey)`. Both columns are `date` (no
  timezone semantics); `monthKey` is a `YYYY-MM` Central
  wall-clock prefix. ✓

- **`monthRangeForKey(monthKey)` / `yearToDateRange()`** return
  `YYYY-MM-DD` strings in PORTAL_TIMEZONE. Used as `.gte/.lte`
  filters on date columns (income_payments.payment_date,
  expenses.date, mileage_logs.trip_date) — apples-to-apples. ✓

- **timestamptz handling**: only `shoots.scheduled_at` is a
  timestamptz column in Phase 4's reads. The ±1 day widening is
  the only timestamptz↔date bridge. See the [CRITICAL] above.

- **`dateKeyInTimezone` at `_lib/suggestions.ts:286`** uses the
  default `PORTAL_TIMEZONE`. ✓

- **`MileageSuggestion.tripDate` derived from the shoot's UTC
  timestamp** (not from `monthKey-${day}`) — correct in spirit:
  the mileage log should land on the actual date Kelsey drove. The
  bug above is about which *month* surfaces the suggestion, not
  which day the resulting trip lands on.

- **`income_payments.payment_date`** defaults to `${monthKey}-01`
  (`suggestions.ts:153`). `expense_template`'s `suggestedDate`
  derived from `monthKey + day_of_month` (`:215, :223`).
  `day_of_month` is constrained `between 1 and 28` (schema:301)
  so Feb is safe. ✓

---

## 9. UI / Visual

- **Editorial palette adherence**: no `border-radius` on any
  suggestion-row chrome, no shadows, no `rounded-full`, no glass,
  no Luxurious Script reference. Inline `<style>` block at
  `FinancialsBoard.tsx:875-970` uses `var(--accent)`,
  `var(--surface-base)`, `var(--text-muted)`, `var(--status-danger)`
  — every color via design token. ✓

- **Suggestion row tint via `color-mix(in srgb, var(--accent) 6%,
  var(--surface-base))`** at `:932,:935`. Browser support is
  Chrome 111+, Safari 16.2+, Firefox 113+ (May 2023). No
  `@supports` fallback. Per spec, no fallback needed; the row
  would simply render at the default `var(--surface-base)` on an
  older browser, losing the tint but still showing the
  ✓/✗ buttons as an iconic differentiator. ✓ No finding.

- **[IMPORTANT]** Phantom-editable cells in suggestion rows:
  `IncomeTable.tsx:263-280` renders Method and Notes cells as
  `<InlineCell type="text" value={null} placeholder="…"
  onCommit={() => Promise.resolve({ ok: true })} />` and
  `ExpenseTable.tsx:260-268` does the same for Notes. The
  `placeholder="Method…"` text appears in italic muted color
  (looks editable); the user clicks in, the cell enters edit
  mode, the user types "Cash", blurs — and the typed value is
  silently discarded because `onCommit` is a no-op. There is
  zero visual indication that the cell is non-functional. Either
  thread the typed value through `patchDraft` (the accept actions
  already accept optional `payment_method` and `notes` —
  `_actions.ts:472-473,536-537`), OR render these cells as
  read-only em-dash like Mileage's miles/rate/deduction
  (`MileageTable.tsx:253-255`) so the user knows they can't edit
  here. The current state is the worst of both worlds: looks
  editable, isn't.

- **Tab navigation through suggestion rows**: each `<InlineCell>`
  renders as a focusable `<button>` in display mode. Document
  order matches column order. The trailing cell contains the
  `<div className="fb-suggestion-actions">` wrapping
  `[<button>✓</button>, <button>✗</button>]` in source order, so
  Tab from the last data cell lands on ✓, Tab again lands on ✗.
  ✓ Matches the audit prompt's expectation.

- **Mileage "Calculating…" state**: `MileageTable.tsx:267-276`
  conditionally renders the italic muted span when `inFlight`. The
  suggestion row is NOT optimistically removed (board handler at
  `FinancialsBoard.tsx:655-693` waits for the response). So the
  user sees the row's actions cell flip from `[✓] [✗]` to
  `Calculating…` and back (on failure) or the row disappears
  entirely (on success). Bug from build Step 7 — "calculating
  state not visible because suggestion removed too eagerly" —
  appears fixed. ✓

- **`sugError` banner** (`FinancialsBoard.tsx:764-797`):
  dismissible (`×` button at `:780-796`), `role="alert"` for
  screen readers (`:766`), uses `var(--status-danger)` for
  border/text and the same `rgba(122,48,64,0.08)` background as
  `errorStyle` from `formStyles.ts`. ✓ NOT persistent across
  navigation — board remounts on month change (the `key` prop),
  clearing `sugError`. Acceptable; the error is about the
  suggestion you just acted on, not a session-level concern.

- **[NIT]** The `sugError` banner uses raw inline styles instead
  of the shared `errorStyle` from
  `app/owner/clients/_components/formStyles.ts`. Same shape,
  different source. Worth importing for consistency.

- **[NIT]** The draft-row error toast (e.g.
  `IncomeTable.tsx:387-401`) and the suggestion banner use
  different visual treatments for the same kind of failure (one
  is an in-table `<tr>` with a colspan cell, the other is a
  standalone banner above the Summary). Both work; the visual
  delta is intentional (suggestion errors are board-wide, draft
  errors are scoped to one row). No finding; called out only as a
  design observation.

- **[NIT]** `MileageTable.tsx:208-220` defines `emDashCell` inline
  inside the `.map` callback — every iteration creates a new
  React element. Trivial perf cost (<10 suggestions per render);
  cosmetic.

---

## 10. Accessibility

- **Buttons have `aria-label`**: ✓
  - `aria-label="Accept suggestion"` (IncomeTable:286,
    ExpenseTable:274, MileageTable:282).
  - `aria-label="Dismiss suggestion"` (IncomeTable:295,
    ExpenseTable:283, MileageTable:290).
  - `aria-label="Delete row"` on the row-delete × (e.g.
    IncomeTable:214). ✓
  - `aria-label="Dismiss error"` on the sugError × button
    (`FinancialsBoard.tsx:782`). ✓
  - `aria-label={props.label}` on every `<InlineCell>` button and
    input (`InlineCell.tsx:259,282,314`). ✓

- **Color is not the only differentiator**: suggestion rows have
  ✓/✗ buttons in the actions cell where real rows have a
  ×. The icon distinction works even with no tint. ✓

- **Keyboard-only flow**: Tab navigates row → row → actions →
  ✓ (Space/Enter to accept) → ✗ (Space/Enter to dismiss).
  `InlineCell` handles Enter (commit) and Escape (cancel) on the
  edit input (`:195-202`). Kelsey can drive the entire flow from
  keyboard. ✓

- **[NIT]** Screen reader announcements for ghost-row → real-row
  transition: when the draft row's last required field is
  committed and the row materialises into a real row plus a fresh
  ghost below, there's no `aria-live` region announcing "Saved."
  The `aria-label`s on the cells flip from "Add date…" placeholder
  to the real value, which a SR will read on next focus, but the
  *transition itself* is silent. Existing portal pattern (no
  `aria-live` anywhere except the alert role on errors), so this
  is a category-wide gap rather than a Phase 4 regression. Worth
  a single `<span aria-live="polite" />` somewhere if Phase 5 has
  appetite for accessibility polish.

- **[NIT]** The `<button>` element used for `<InlineCell>` display
  mode has `type="button"` (`InlineCell.tsx:255`) ✓ — no risk of
  accidental form submit if it ever ends up inside a `<form>`.

- **[NIT]** The `aria-disabled` on the toolbar's YTD-state Prev/Next
  buttons (`FinancialsToolbar.tsx:54-58, 86-89`) uses `<span>`
  rather than a disabled `<button>`. The `<span>` is not in the
  tab order; the rendered character `◀` won't be operable. ✓
  Pre-existing pattern.

---

## 11. Performance

- **`fetchSuggestionInputs` Promise.all** at `:349-380` runs 8
  parallel awaits (clients + app_settings + shoots + templates +
  dismissed + income + expense + mileage). Both `fetchAppSettings`
  callers (one here, one in `fetchFinancialsForRange`) share the
  result via `React.cache()` at `_lib/queries.ts:23` — verified:
  the page calls `fetchFinancialsForRange` and
  `fetchSuggestionInputs` in parallel
  (`page.tsx:98-106`), both internally await `fetchAppSettings()`,
  one DB hit. ✓

- **`fetchSuggestionInputs` vs `fetchFinancialsForRange` fold**:
  the two queries select different column subsets from the same
  three tables (`income_payments`, `expenses`, `mileage_logs`).
  Fold would save ~3 round trips at the cost of pulling display
  columns Phase 4 doesn't need. Acceptable separation; current
  parallel calls keep each fetcher's intent clear and amortise on
  the network round-trip cost. Don't merge unless profiling shows
  a real win.

- **`fetchClientsWithRelations` overhead**: pulls a separate
  time_logs query for `hoursThisMonth` (`clients/_lib/queries.ts:55-69`)
  even though Phase 4 only needs `(id, name, type, status,
  pkg.monthly_price)` for income suggestions. When the user lands
  on `/owner/financials` directly (not via the dashboard in the
  same render), this query is wasted. The Phase 4 audit's §4
  recommendation was "keep the cache-wrapped function" — still
  the right call. A narrower fetcher (e.g.
  `fetchActiveBrandRetainers()`) is a future optimisation; recommend
  **keep** until profiling shows it matters.

- **Compute functions**: all O(n) over their inputs.
  `satisfiedByFk` / `satisfiedByDateClient` / `satisfiedClientIds`
  are `Set`-keyed for O(1) lookup inside the suggestion loop.
  Suggestion list is small (<10 per category). No quadratic
  behavior. ✓

- **Distance Matrix not cached**: per spec; acceptable for the
  accept-only model. Behavior unchanged. ✓

- **[NIT]** The suggestion-suppression query for mileage
  (`suggestions.ts:376-379`) selects `source_shoot_id, trip_date,
  client_id`. The result is iterated to build two `Set`s; only one
  of the two is used per row (FK or date+client, mutually
  exclusive). The Set construction is O(rows). Trivial. ✓

---

## 12. Schema & Migrations

- **Migration `001_phase4_suggestions.sql`**:
  - Idempotent: every DDL uses `if not exists` /
    `add column if not exists` /
    `create index if not exists`. Safe to re-run. ✓
  - Transactional: no explicit `BEGIN/COMMIT`. Each DDL is its
    own implicit transaction. Acceptable for fully-idempotent
    migration; a partial failure of one DDL leaves the rest
    re-runnable.
  - Indexes justified:
    - `dismissed_suggestions_period_idx` (`:46-47`) — the
      page-load query filters on `period_yyyymm`; index speeds
      it up. ✓
    - `mileage_logs_source_shoot_id_idx` (`:74-75`) and
      `expenses_source_template_id_idx` (`:77-78`) — partial
      `WHERE … IS NOT NULL` keeps them small on tables where
      most rows are manual. ✓

- **Source / source_shoot_id / source_template_id columns**:
  all three nullable, all three semantically "NULL = manual."
  Type definitions at `lib/supabase.ts:124, 188, 210` mirror.
  Existing rows treated as manual implicitly — no backfill
  required. ✓

- **`dismissed_suggestions` unique constraint** at
  migration:38-40: `unique (type, reference_id, period_yyyymm)`
  ✓ — covers the conflict target used by `upsert(...)` at
  `_actions.ts:727`.

- **`income_payments.source` CHECK** at migration:60-61 accepts
  `'manual' | 'suggested_retainer'`. The app never writes
  `'manual'` (manual inserts pass `source: null` implicitly).
  Allowing `'manual'` in the enum is **[DEAD]** — works fine,
  but documents an unimplemented intent. Either remove `'manual'`
  from the check (NULL becomes the sole "manual" marker) or
  start writing `'manual'` from `addIncomePaymentAction` for
  consistency. Recommend the former: simpler, matches the
  audit's "NULL = pre-Phase-4 implicit manual" framing.

- **`schema.sql` vs migration drift**:
  - `schema.sql` does NOT have `dismissed_suggestions` table.
  - `schema.sql` does NOT have `source`,
    `source_shoot_id`, or `source_template_id` columns.
  - Migration 001 has both.
  - This matches the project's documented pattern (migrations
    are the source of truth; `schema.sql` trails until a
    greenfield init). No finding; called out because the audit
    prompt asked.

- **[NIT]** `migration:36` uses Postgres ARE regex
  (`~ '^\d{4}-\d{2}$'`). Postgres ARE supports `\d`; portable.
  Cosmetic preference: `[0-9]{4}-[0-9]{2}` is more universally
  understood and matches the JS regex in `_actions.ts:713`.

- **[NIT]** `expenses.amount` still lacks a DB-level
  `check (amount > 0)`. Phase 1 / Phase 3a / Phase 3b audits all
  noted; Phase 4 didn't address. Validation is enforced by the
  three TS code paths (`addExpenseAction`,
  `updateExpenseAction`, `acceptExpenseSuggestionAction`) but a
  fourth code path or a manual `INSERT` would bypass. One-line
  migration: `alter table expenses add constraint
  expenses_amount_positive check (amount > 0);`.

---

## 13. Dead Code From Earlier Phases

- **[NIT]** `supabase/schema.sql:237-240` — *"in Phase 4 a paid
  invoice will create an income_payment automatically."* Not
  implemented in Phase 4 (Phase 4 was suggestions, not
  invoice→income wiring). Comment is stale. Revise to *"a future
  phase will…"* or drop the speculation.

- **[NIT]** `supabase/schema.sql:291` — *"Phase 4 will auto-create
  matching expenses rows on day_of_month."* Phase 4 created
  *suggestions* keyed by `day_of_month`, not auto-inserted
  expenses. Comment is stale. Revise to describe the suggestion
  behavior or drop the forward-reference.

- **Inline tax-rate read in `queries.ts`**: was at lines 112-117
  per Phase 4 audit §3. Now replaced by the shared
  `fetchAppSettings` cache (`queries.ts:23-33`, called at
  `:135` and `_lib/suggestions.ts:351`). Old path fully
  removed. ✓

- **Mileage-rate read in `_actions.ts`**: was at lines 335-342
  per Phase 4 audit §3. Now uses `fetchAppSettings` at
  `_actions.ts:344, :622`. Old path fully removed. ✓

- **[DEAD-CODE]** As called out in §1: the `_monthKey` / `void`
  pattern, the duplicate `SugResult`/`CommitResult` types, the
  three sort helpers, and the inert `sugInFlight` machinery in
  Income/Expense tables. All scaffolding left behind by Steps 4–6
  that Step 7's cleanup pass missed.

---

## 14. Docs & Comments

- **`docs/features/scheduling.md` exists** (`docs/features/`). No
  equivalent `docs/features/financials.md` for Phase 4. With
  Phases 1–4 done, a single `financials.md` covering the
  schema/contract, the suggestion suppression rules, the
  Distance Matrix integration, and the `dismissed_suggestions`
  lifecycle would be a high-value reference. **Recommend
  adding** before Phase 5 builds on top.

- **Inline comments**: largely accurate, with three categories of
  staleness:
  1. Build-step references (Step 5 / Step 6) — see §1.
  2. "Phase 4 will…" / "Phase 4 added…" framing in
     `_lib/queries.ts:14`, `_lib/suggestions.ts:2`,
     `_actions.ts:455` — readable but stylistically out of
     place once the feature has shipped.
  3. Forward-reference comments in `schema.sql` (§13).

- **JSDoc on new public exports**: high coverage where it
  matters.
  - `_lib/suggestions.ts` exports — every compute function +
    `fetchSuggestionInputs` has a doc block (`:122-128`,
    `:185-190`, `:245-254`, `:306-308`). ✓
  - `IncomeSuggestion.incomeType` documents the widening
    rationale (`:42-46`). ✓
  - `lib/google-maps.ts:42-55` documents throwing conditions and
    the catch-and-convert expectation. ✓
  - `_actions.ts` accept actions have one-block comments at
    the top of each (`:459-464`, `:524-529`, `:583-593`,
    `:686-693`). ✓
  - **[NIT]** `_actions.ts` add/update/delete actions for
    income/expense/mileage lack any JSDoc. Phase 3a/3b shipped
    them without; Phase 4 didn't add them. Consistent, but
    a minimal "what the action does + which table" block at
    each public export would help readers landing on this 736-line
    file cold.

- **[NIT]** `_actions.ts:1-2` has no file-header comment. The
  Phase-4-specific section at `:454-456` is the only divider in
  the file. Consider a top-of-file comment summarising what each
  table's actions do, plus a "Phase 4: search for `acceptX` /
  `dismissX`" pointer.

---

## 15. Testing Gap

- **No tests anywhere in the app.** `package.json` ships only
  `lint` and `typecheck`; no test framework installed. `Glob
  **/*.test.ts` returns only `node_modules` fixtures. ✓ (confirmed
  via no app-level matches).

- **What a minimum test set would cover** (highest-priority issues
  from this audit, *not* a build prompt — just an inventory):

  1. **Month-boundary mileage suggestion** — pure-function test on
     `computeMileageSuggestions`. Construct a shoot whose
     `scheduled_at` falls inside the widened window but whose
     `dateKeyInTimezone` is in the *previous* month; assert the
     suggestion is NOT emitted for the displayed month. This
     would catch the [CRITICAL] from §5/§8 today.

  2. **Suppression by FK** — for each compute function, supply
     an existing record with the FK (`source_template_id`,
     `source_shoot_id`, `client_id + income_type +
     payment_date`) and assert the corresponding suggestion is
     suppressed even when the name fallback would not match.

  3. **Suppression by name fallback (expense)** — supply an
     existing expense with `source_template_id = null` but
     `description` matching the template name (case-insensitive,
     whitespace-trimmed); assert suppression.

  4. **Dismissed key format** — `dismissed.has('income_retainer:${clientId}')`
     and the equivalents; assert mismatched formats (extra
     whitespace, wrong type prefix) do NOT suppress.

  5. **`home_address.trim() === ""` short-circuits mileage
     suggestions to `[]`** — assert no DB queries are made past
     the guard.

  6. **`recomputeSummary` parity** — feed the same rows to the
     server `queries.ts:241-247` math and the client
     `FinancialsBoard.tsx:161-185` math; assert all five output
     fields match exactly (catches future drift).

  7. **Accept action rejection** — `acceptIncomeSuggestionAction`
     with empty `client_id`, with empty `client_name_snapshot`,
     with `amount <= 0`, with non-enum `income_type`, with
     invalid date. Six unit cases per action × four actions = 24
     assertions; trivial to write.

  8. **`getMilesBetween` error paths** — mock fetch to return
     non-OK status, error_message, ZERO_RESULTS element,
     missing distance payload. Assert each throws.

  9. **Round-trip doubling** — `acceptMileageSuggestionAction`
     with mocked `getMilesBetween` returning 12.3; assert the
     `mileage_logs.miles` insert receives 24.6.

  10. **dismissSuggestionAction idempotency** — call twice with
      the same payload; assert second call also returns `ok:
      true` with no error.

  Pick a lightweight runner (vitest is the standard fit for
  Next.js 15 + React 19); skip JSX-heavy tests for now (no
  precedent in the codebase). The compute/action pure-function
  surface is the highest-value target.

---

## Priority Fix List

Ranked by impact-vs-effort. Each item references the audit
section it came from.

1. **[CRITICAL] Mileage suggestion month-bucketing** (§5, §8).
   Add `if (!tripDate.startsWith(monthKey)) continue;` after
   `_lib/suggestions.ts:286`. One line. Highest impact: prevents
   silent duplicate mileage_logs inserts at month boundaries.

2. **[IMPORTANT] Phantom-editable cells in suggestion rows**
   (§9). `IncomeTable.tsx:263-280` and `ExpenseTable.tsx:260-268`
   render text inputs with `onCommit = no-op`. Either wire
   through `patchDraft` (and pass `payment_method` / `notes` into
   the accept action's optional fields) OR replace with read-only
   em-dash cells. Either fix is small; pick based on UX intent.

3. **[DEAD-CODE] FinancialsBoard cleanup** (§1). Remove the
   `_monthKey`/`void` pattern, the duplicate
   `SugResult`/`CommitResult` types, the three sort helpers
   (`sortIncome` etc. → one generic), and the inert `sugInFlight`
   tracking in IncomeTable/ExpenseTable. Tiny per-item, but
   together they tighten ~80 lines and remove the Step-5/Step-6
   scaffolding that the cleanup pass missed.

4. **[IMPORTANT] Stale-state duplication on accept** (§4). Add
   a satisfaction re-check inside each `accept*` action just
   before insert. ~6 lines per action × 3 actions = ~20 lines.
   Failure path returns `"Already logged this month"`. Prevents
   the realistic Kelsey-toggles-between-tabs failure mode.

5. **[IMPORTANT] Factor `isValidDateKey` and
   `isPositiveFiniteNumber` to `lib/validation.ts`** (§3). New
   file, ~12 lines, update 13 call sites in
   `app/owner/financials/_actions.ts` + 3 sites in
   `app/owner/calendar/_actions.ts` (rename `isValidDate` → use
   the new helper). Eliminates a duplication explicitly flagged
   in the Phase 4 pre-build audit.

6. **[IMPORTANT] `sugDrafts` Map leak on accept/dismiss** (§6).
   Add `setSugDrafts(m => { const n = new Map(m); n.delete(refId);
   return n; })` in the success branch of each accept/dismiss
   handler. Three tables × two handlers = six call sites; ~3
   lines each. Bounded leak; cheap fix.

7. **[NIT] Stale build-step / "Phase 4 will" comments**
   (§13, §14). Mechanical text edits to
   `FinancialsBoard.tsx:148, 198, 204, 930`,
   `_lib/suggestions.ts:2, 34`, `_actions.ts:455`,
   `schema.sql:237-240, 291`. Useful for future readers.

8. **[NIT] Add `console.error(err)` inside
   `acceptMileageSuggestionAction`'s catch** (§4). One line.
   Lets Distance Matrix failures surface in Vercel logs while
   keeping the user-facing message friendly.

9. **[NIT] Document the symmetric "no doubling in manual entry"
   in `addMileageLogAction`** (§7). One-line comment near
   `_actions.ts:357-369`. Prevents future-you from adding the
   doubling here.

10. **[NIT] Add `expenses.amount > 0` CHECK constraint**
    (§12). One-line migration, defense-in-depth against any
    future code path that bypasses the TS validation.

---

## What's Solid

- **Phase 4 audit assumptions held up.** Every recommendation
  the pre-build audit made was implemented as written: the
  shared `fetchAppSettings` cache wrapper (§3), the
  `dismissed_suggestions` table with the recommended unique
  constraint (§7), the three nullable origin columns (§5), the
  `lib/google-maps.ts` location (§8), the
  `requireOwner`/`revalidatePath` shape of the accept/dismiss
  actions (§5), the snapshot-and-restore optimistic pattern
  inherited from Phase 3a (§9). No drift between plan and code.

- **Bit-identical `recomputeSummary` formula** between server
  `queries.ts:241-247` and client
  `FinancialsBoard.tsx:161-185`. Easy to break, didn't.

- **Suppression layering is clean.** FK match takes precedence;
  fallback (name match for expenses, date+client for mileage)
  catches pre-Phase-4 rows. Both buckets checked; neither
  silently masks the other. The Phase 4 audit warned about
  fuzzy fallback rot; the FK columns Phase 4 introduced are
  the long-term answer.

- **Round-trip mileage doubling is well-placed and
  documented.** `acceptMileageSuggestionAction` (`:646`)
  doubles the one-way distance with a code comment explaining
  why (`:640-645`). Manual `addMileageLogAction` correctly
  doesn't double. Asymmetry is the right call.

- **Distance Matrix wrapper is minimal and honest about its
  throws.** `lib/google-maps.ts` lists the five throwing
  conditions in the JSDoc (`:42-55`); the action catches and
  converts uniformly (`_actions.ts:632-639`). No leaky
  abstractions.

- **Page composition is right.** `page.tsx` keeps server
  rendering for the heavy fetches + suggestion compute, hands
  the result to `FinancialsBoard` (client) for interactivity.
  The `key={range/monthKey}` prop guarantees a clean state
  reset on navigation. The `range === "ytd"` short-circuit
  for suggestion computation is correct and cheap
  (`page.tsx:100-106`).

- **Idempotent migration.** Every DDL in
  `001_phase4_suggestions.sql` uses
  `if not exists` / `add column if not exists`; safe to re-run
  on a partially-applied database. Partial indexes for the FK
  columns keep the size proportional to the suggestion-accepted
  subset rather than the full table.

- **The mileage-suggestion "Calculating…" state** survives. The
  build's Step 7 fix (don't optimistically remove the suggestion
  before the Distance Matrix call resolves) is in place and
  visible in the code (`FinancialsBoard.tsx:655-693` defers
  the `setMileageSugState` filter until after the await).

- **`role="alert"` on the `sugError` banner** — proper SR
  treatment for an asynchronous error appearing in a busy
  table view.

- **Type definitions in `lib/supabase.ts`** updated cleanly for
  Phase 4: `IncomePaymentSource`, `SuggestionType`,
  `DismissedSuggestionRecord`, plus the new nullable `source` /
  `source_*_id` fields on the existing record types. Registered
  in the `Database` shape (`:269-271`) so Supabase select
  inference works.

---

## Architectural Notes (Beyond Phase 4 Scope)

These are user-memory items / cross-feature observations relevant
to financials, not Phase 4 findings per se.

1. **`requireOwner()` duplication across `_actions.ts` files.** All
   six `_actions.ts` files import the same helper from
   `lib/auth.ts:8-20`; that part is fine. What duplicates is the
   *guard pattern* — every action opens with the same three
   lines:
   ```ts
   const guard = await requireOwner();
   if (!guard.ok) return { ok: false, error: guard.error };
   ```
   Phase 4's `_actions.ts` has it 14 times in this one file.
   Consolidation options:
   - A `withOwner(handler)` higher-order function that wraps the
     action body. Pros: removes the repetition; cleanly attaches
     `ownerLabel` to a context. Cons: indirection, harder to
     read at a glance, doesn't match existing portal style.
   - A no-op (status quo). The repetition is shallow and
     consistent across the entire portal — consolidation gains
     ~3 lines per action at the cost of a layer of abstraction
     no other feature uses.
   - **Recommend status quo for now.** Revisit if a 7th
     `_actions.ts` shows up. The repetition is recognisable, not
     misleading.

2. **`ActionResult<T>` re-declared in every `_actions.ts`** (6
   files). Phase 3a audit §A flagged this. Phase 4 inherits.
   Factoring to `lib/actions.ts` or `lib/types.ts` is a 3-line
   PR; deferred because no Phase 4 finding turns on it.

3. **No shared "money parser" / "amount validator" helper.** Per
   the Phase 3a audit §F, every parser is local. Phase 4 didn't
   add one; the suggestion accept actions trust pre-validated
   numbers from the table component. Acceptable.

---

## Ship Before Phase 5 vs Can Wait

**Ship before Phase 5** (would compound if Phase 5 builds on top):

- The [CRITICAL] mileage month-bucketing fix (§5, §8). Phase 5
  is likely to layer something else on `mileage_logs` (CSV
  export? per-shoot summary?); fixing the bug now prevents
  every downstream feature inheriting it.
- The phantom-editable Method/Notes cells (§9). Sets a bad
  precedent for "this cell looks editable but isn't" if a
  future phase introduces similar suggestion rows.
- The `_monthKey`/`void` and stale build-step comments (§1).
  If Phase 5 touches `FinancialsBoard`, the scaffolding will
  confuse the reader.
- Factor `isValidDateKey` / `isPositiveFiniteNumber` (§3) — if
  Phase 5 adds more actions, the duplication compounds.

**Can wait** (no compounding cost):

- `sugDrafts` Map leak (§6) — bounded to a single
  month-render.
- Stale-state duplication on accept (§4) — annoying but
  user-recoverable; cheap to fix later in a "polish" pass.
- `expenses.amount > 0` CHECK (§12) — pre-existing gap, no
  Phase 4 regression.
- Removing `'manual'` from the `income_payments.source` CHECK
  (§12) — cosmetic.
- Stale schema.sql "Phase 4 will…" comments (§13) — readable
  enough.
- `docs/features/financials.md` (§14) — high-value reference
  but not blocking.
- Tests (§15) — useful, never blocking. If anything ships
  first, the month-boundary test from §15.1 is the one whose
  absence has the highest ongoing cost.
