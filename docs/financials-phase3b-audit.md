# Phase 3b Audit — Financials Ghost-Row Creation

Read-only inventory of patterns, primitives, and risks before any
feature code is written. Scope: a "ghost row" beneath each of the
three tables on `/owner/financials` for creating new income payments,
expenses, and mileage entries inline. Edit + delete on existing rows
shipped in Phase 3a.

---

## A. Required vs optional columns per table

Source of truth: `supabase/schema.sql`. Server-defaulted columns
(those with `default …`) and `logged_by` (set by the action from
`requireOwner().ownerLabel`) do not need client input.

### income_payments (schema.sql:242-256)

| Column | Null? | CHECK / Default | Source of value |
|---|---|---|---|
| id | NOT NULL | default gen_random_uuid() | server default |
| client_id | nullable | FK clients(id) on delete set null | deferred (stays null in 3b) |
| client_name_snapshot | **NOT NULL** | — | **client must supply** |
| payment_date | **NOT NULL** | — | **client must supply** |
| amount | **NOT NULL** | check (amount > 0) | **client must supply** |
| income_type | **NOT NULL** | check in 4-enum | **client must supply** |
| payment_method | nullable | — | optional |
| notes | nullable | — | optional |
| logged_by | **NOT NULL** | — | **server** (`guard.ownerLabel`) |
| created_at | NOT NULL | default now() | server default |

**Required ghost cells**: date, client_name_snapshot, amount,
income_type. Confirmed — `client_name_snapshot` IS NOT NULL, so even
though "linked client" is deferred, the ghost row absolutely needs a
text input for client name. The Phase 3a IncomeTable already displays
this as `row.clientName` from `client_name_snapshot`, so the data
flow is in place.

**Optional ghost cells**: payment_method, notes.

### expenses (schema.sql:139-148 with alignment block at 383-388)

| Column | Null? | CHECK / Default | Source of value |
|---|---|---|---|
| id | NOT NULL | default gen_random_uuid() | server default |
| category | **NOT NULL** | check in new 6-enum (alignment block swap) | **client must supply** |
| description | nullable | — | optional |
| amount | **NOT NULL** | (no DB-level positivity check — gap) | **client must supply** |
| date | **NOT NULL** | — | **client must supply** |
| receipt_url | nullable | — | deferred / not in 3b UI |
| notes | nullable | — | optional |
| created_at | NOT NULL | default now() | server default |

**Required ghost cells**: date, category, amount.
**Optional ghost cells**: description, notes.

**No `logged_by` column** on `expenses` — unique to this table. The
create action does not need `guard.ownerLabel`. The create action
should still call `requireOwner()` for auth, just doesn't write the
label.

**Reminder of gap**: no DB-level `check (amount > 0)`. The Phase 3a
`updateExpenseAction` enforces it in TS — Phase 3b's
`createExpenseAction` must do the same.

### mileage_logs (schema.sql:271-284)

| Column | Null? | CHECK / Default | Source of value |
|---|---|---|---|
| id | NOT NULL | default gen_random_uuid() | server default |
| trip_date | **NOT NULL** | — | **client must supply** |
| from_address | **NOT NULL** | — | **client must supply** |
| to_address | **NOT NULL** | — | **client must supply** |
| start_odometer | nullable | check (null or >= 0) | deferred / not in 3b UI |
| end_odometer | nullable | check (null or >= 0) | deferred / not in 3b UI |
| miles | **NOT NULL** | check (miles > 0) | **client must supply** |
| rate_per_mile | **NOT NULL** | check (rate >= 0) | **server-read from app_settings** |
| client_id | nullable | FK on delete set null | deferred (stays null in 3b) |
| notes | nullable | — | optional (but not exposed in MileageTable UI per Phase 3a) |
| logged_by | **NOT NULL** | — | **server** (`guard.ownerLabel`) |
| created_at | NOT NULL | default now() | server default |

**Required ghost cells**: trip_date, from_address, to_address, miles.
**Optional ghost cells**: none in the current MileageTable column set.
**Server-supplied at write time**:
- `rate_per_mile` — must read from `app_settings.mileage_rate_per_mile`
  inside `createMileageLogAction`. This is a NEW server-side read that
  doesn't exist anywhere in `app/owner/financials/_actions.ts` today.
  The pattern to mirror: `_lib/queries.ts:112-117` already reads
  `app_settings` with `.eq("singleton", true).maybeSingle()`. Copy
  inline; don't extract a helper yet.
- `logged_by` — `guard.ownerLabel`, same as income.

---

## B. Existing create-row server action shape

### addTimeLogAction (`app/owner/clients/_actions.ts:34-70`)

```ts
export interface AddTimeLogInput {
  clientId: string;
  date: string;
  hours: number;
  category: TimeLogCategory;
  notes: string;
}

export async function addTimeLogAction(
  input: AddTimeLogInput
): Promise<ActionResult<TimeLogRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.clientId) return { ok: false, error: "Missing client id" };
  if (!input.date) return { ok: false, error: "Date is required" };
  if (!Number.isFinite(input.hours) || input.hours <= 0) {
    return { ok: false, error: "Hours must be greater than 0" };
  }
  if (!VALID_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "Invalid category" };
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("time_logs")
    .insert({
      client_id: input.clientId,
      logged_by: guard.ownerLabel,
      date: input.date,
      hours: input.hours,
      category: input.category,
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to log time" };
  }

  revalidatePath(`/owner/clients/${input.clientId}`);
  revalidatePath("/owner/clients");
  return { ok: true, data: data as TimeLogRecord };
}
```

Key shape elements:
- Input as a typed interface (named `AddXInput`, not `CreateXInput`).
- `requireOwner()` guard, returns guard.error if not owner.
- Synchronous field-by-field validation, early return on each failure.
- `.insert({...}).select("*").single()` — **returns the created row in `data`**.
- `revalidatePath(...)` after success.
- Returns `ActionResult<TimeLogRecord>` — the row IS in `data`.

### createShoot (`app/owner/shoots/_actions.ts:57-118`)

Same shape, with two minor differences:
- Naming convention is `createShoot` not `addShoot`. Both are in use
  across the codebase — pick one for Phase 3b. **Recommend `addX`**
  for symmetry with `updateXAction` / `deleteXAction` naming pattern
  already established in `app/owner/financials/_actions.ts`.
- More complex cross-field validation (kind+meeting_type interlock).
  Not relevant here.
- Also `.insert(...).select("*").single()` and returns the row in
  `data`.

### Implication for Phase 3b

The optimistic-create flow can rely on the action returning the
fully-populated new row (with server-issued `id`, `created_at`, and
for mileage the `rate_per_mile`). The client doesn't have to refetch
or guess these values — paste them straight into board state when
the action resolves.

---

## C. Existing client-side optimistic-create patterns

### MessageThread is the only precedent — and it's directly relevant

`components/messages/MessageThread.tsx:368-382` is the canonical
optimistic-create pattern in the portal. Sketch:

```ts
const handleSend = useCallback(() => {
  const trimmed = composer.trim();
  if (!trimmed) return;
  const pending: PendingMessage = {
    tempId: `temp-${crypto.randomUUID()}`,
    body: trimmed,
    sender_role: viewerRole,
    sent_at: new Date().toISOString(),
  };
  setPendingMessages((prev) => [...prev, pending]);
  setComposer("");
  // ...
  void sendOnce(pending);
}, [composer, viewerRole, sendOnce]);
```

State buckets are split (line 71-72): `pendingMessages` and
`failedMessages` are kept separate from `messages` (the confirmed
server rows). On success, the pending bubble is removed
(`MessageThread.tsx:350-352`) and a poll refetch surfaces the real
row. On failure, the pending bubble moves into `failedMessages` for
retry (`MessageThread.tsx:359-363`).

There's also a `recentlyConfirmedRef` map
(`MessageThread.tsx:84-87, 178`) that maps server-confirmed id →
prior tempId, so the React `key` stays stable across the
pending→confirmed swap (smooth opacity transition).

### Why financials can be SIMPLER than messages

Three reasons messages need the complexity, and three reasons
financials doesn't:

1. Messages relies on a **polling refetch** to surface the real row,
   so the pending bubble has to live separately from the confirmed
   list — otherwise the poll's incoming list and the pending bubble
   would race. Financials has no polling (`useVisibilityPolling` is
   messages-only per the Phase 3a audit). The action's returned row
   IS the source of truth for the new row.
2. Messages are append-only and time-ordered, so the swap is purely
   visual continuity. Financials rows have a defined sort order
   (queries.ts: `payment_date DESC, created_at DESC` for income,
   etc.) so a newly inserted row needs to land in the correct slot.
   Splitting into pending/confirmed buckets makes sort placement
   awkward.
3. Messages are tiny (one text body). Financials rows have multiple
   fields and a draft-vs-real distinction that already exists
   conceptually in the ghost row itself.

### Recommended approach: Option A (visible-during-save)

Ghost row collects values → on commit-trigger, the row stays in place
(visible, disabled inputs, slightly muted) while the action runs →
on success, the action returns the new row, which gets:
- spliced into `incomeRows`/`expenseRows`/`mileageRows` at the
  correct sorted position (mirror the server's
  `.order("payment_date", { ascending: false })` etc.),
- the draft state cleared (a fresh ghost row reappears below).

On failure: the draft row stays in place with values intact, an
inline error message, and the inputs become editable again.

This is essentially the MessageThread pattern without the tempId map
or polling-induced split. Implementation lives entirely in
FinancialsBoard.

---

## D. ID generation for draft rows

`crypto.randomUUID` is in client-side use exactly once:
`components/messages/MessageThread.tsx:372` —
``tempId: `temp-${crypto.randomUUID()}` ``.

No other client code in the repo generates UUIDs. No counters, no
`nanoid`/`uuidv4` packages installed (verified via the grep that only
turned up `package-lock.json` boilerplate and one docs reference).

For the ghost row's React key:

- **Literal `"draft"` string**: works because Phase 3b has at most
  one ghost row per table at any moment. Simplest possible. Risk:
  if React's reconciliation gets confused when the draft turns into
  a real row, the new real row inherits the same key briefly.
- **`temp-${crypto.randomUUID()}`**: matches the established
  convention, costs nothing, and avoids the key-collision concern
  above by guaranteeing a fresh key per fresh ghost.

**Recommend `temp-${crypto.randomUUID()}`** — same pattern as the
only existing precedent, no upside to deviating.

---

## E. Ghost-row visual treatment

No "placeholder row" or "empty-state row" pattern exists in the
portal. The closest precedents are "empty list" messages:
- `EmptyP` (`app/owner/financials/_components/FinancialsBoard.tsx`,
  `app/owner/financials/page.tsx` original) — `color: var(--text-muted)`,
  italic-feeling but not actually italic, centered, in a card body.
- `app/owner/time/page.tsx` "No time logged this week yet." — same
  shape.

These all REPLACE the row list. They don't sit alongside it. Ghost
rows are new visual territory.

Recommended treatment for the ghost row (no codebase precedent to
copy; this is design work):

- **Row background**: same `var(--surface-raised)` as other rows.
  Don't add a third tone. The cells themselves carry the "empty"
  affordance.
- **Cell text in display mode**: when value is null/empty, show
  italic placeholder text in `var(--text-muted)`. E.g., `"Add date…"`,
  `"Add description…"`. Italic distinguishes it from real cell text
  (the rest of the portal is sans-italic).
- **Cell borders**: the existing `.fb-cell-display` hover-border hint
  works fine for ghost cells too. No special treatment.
- **No "Add row" label or button**: the placeholder text IS the
  affordance. Tab into a placeholder, type, tab out.
- **No row dividing line above the ghost row**: the global
  `border-bottom: 1px solid var(--border)` on `tbody td` from
  `globals.css:91` already separates it from the row above.
- **During save**: row stays visible, inputs disabled, opacity 0.85
  (matches the Phase 3a in-flight cell border-color: var(--accent)
  treatment). No spinner.
- **On failure**: a small inline error block under the row (matches
  Phase 3a's "error stays inline at the cell"). For row-level errors
  (e.g. "Failed to save: amount must be greater than 0"), surface
  inside the row's row-actions cell or just below the table —
  whichever fits the existing rhythm.

---

## F. Required-field validation flow

The Phase 3a InlineCell commits on blur. For Phase 3b, the question
is when the *whole* ghost row commits — only one create-action call
per row, not one per cell.

### What the codebase precedent says

`addTimeLogAction` is called from `QuickLogForm.handleSubmit`
(`app/owner/time/_components/QuickLogForm.tsx:100-156`). The submit
button is the explicit commit signal. Required-field validation
happens client-side in `handleSubmit` before the action fires.

There is **no precedent** in the portal for implicit row commit
("once required fields are filled, the row materializes"). Every
existing create flow has a button.

### Three options for Phase 3b

1. **Auto-commit on blur once required fields are complete.** User
   fills cells in any order; the first blur after the last required
   cell is populated kicks off the create action. Subsequent blurs
   on optional cells hit the (Phase 3a) update action because the
   row now has a real id. Closest to the spreadsheet feel. Cost:
   user can't "stage" partial input without it auto-committing once
   complete, and there's no explicit moment of commitment so a
   typo could create unwanted rows.
2. **Auto-commit on Enter or Tab-from-last-cell.** Same as the
   spreadsheet model. User signals "done" with an explicit key
   gesture. Less surprising than (1) but doesn't gracefully handle
   "fill cells out of order" — Tab from the rightmost cell only
   commits if the rightmost cell happens to be filled last.
3. **Explicit + button or "save row" affordance**, enabled once
   required fields are present. Matches existing portal precedent
   (QuickLogForm). Loses the spreadsheet feel.

### Recommendation

**Option 1 (auto-commit on blur once required complete)** matches
the spec's stated intent and feels right for a spreadsheet. Mitigate
the "silent commit" surprise with:
- A momentary visual confirmation (the row briefly highlights or
  flashes once it transitions from draft to real). Or just rely on
  the "fresh ghost row appears below" as the implicit confirmation —
  Kelsey will see a new empty row appear, signalling "yours just
  saved."
- A small "Saving…" indicator at the row-actions cell while the
  action is in flight, so there's clear feedback that something is
  happening.

This is consistent with Phase 3a's "no toasts, inline feedback"
posture.

---

## G. InlineCell support for empty/placeholder state

### What InlineCell handles today

From `app/owner/financials/_components/InlineCell.tsx`:

| Type | Today's `value` prop | Empty-state handling |
|---|---|---|
| date | `string` (required) | None — `<input type="date" value="">` would crash or render blank natively; the no-op check `parsed === value` would always fire commit |
| money | `number` (required) | None — `String(value)` would render `"0"` for 0, but parser rejects 0 |
| number | `number` (required) | None — same as money |
| text | `string \| null` (nullable!) | Display mode renders `props.value ?? props.emptyDisplay ?? "—"` — basically already handles it |
| enum | `string` (required) | None — must match one of options |

So **`text` cells already handle empty state** via the `emptyDisplay`
prop. The other four types have no concept of "no value yet."

### Recommendation: extend InlineCell, don't fork

Two changes to `InlineCell.tsx`:

1. **Make `value` nullable for all types**: `value: string | null` for
   date and enum; `value: number | null` for money and number.
2. **Add `placeholder?: string`** to BaseProps. When in display mode
   and `value === null`, render `placeholder` in italic +
   `var(--text-muted)`. Same affordance for all five types.

Minor edits to the existing parsing and isUnchanged logic:

- `valueToDraft()` when `value === null`: return `""` for date/text/
  enum, return `""` for money/number too (so the input shows
  empty, not `"0"`).
- `parseDraft()` for empty `""` on date/money/number/enum: stay in
  edit mode silently (no error UI) if user just opened the cell and
  blurred without typing — i.e., distinguish "user cleared a draft
  cell" from "user typed garbage." Practically, both cases land on
  `cleaned === ""` → return `{ ok: false, error: "Required" }`. For
  ghost cells that's fine (cell stays in edit mode showing the
  placeholder again on next render). For Phase 3a edit cells, this
  behavior change means: clearing a required cell now silently
  rejects instead of trying to commit. That's an improvement, not a
  regression.
- `isUnchanged()` when `value === null`: parsed `null` (text) or
  empty draft is "unchanged"; non-null parsed value is "changed."

This is ~20 lines of edits in InlineCell.tsx. Forking into a
DraftInlineCell would duplicate every behavior in the cell. Don't
fork.

The two callers in Phase 3a (IncomeTable / ExpenseTable / MileageTable)
keep passing non-null `value` props and never see the nullable path
— TS narrows correctly because they always supply a value.

---

## H. The ghost row's own state lifecycle

Mirror the Phase 3a separation exactly:

- `FinancialsBoard` owns `draftIncomeRow`, `draftExpenseRow`,
  `draftMileageRow` as separate state. Each is `Partial<DraftXRow> |
  null` (null = ghost has no values yet; non-null = ghost has at
  least one field populated).
- Board provides `onDraftIncomeFieldChange(field, value)`,
  `onDraftIncomeCommit()`, and equivalents per table.
- Tables receive `draftRow` and these callbacks as props. Tables
  render the ghost row inline below the real rows.

This matches Phase 3a's "board owns optimism, tables stay thin"
shape. Adding a draft-row dimension on top of the existing rows
state doesn't change that.

A new type per table for the draft shape:
```ts
type DraftIncomeRow = {
  date: string | null;
  clientName: string | null;
  amount: number | null;
  incomeType: IncomeType | null;
  paymentMethod: string | null;
  notes: string | null;
};
```
And equivalents. The "all fields are nullable" version of the
display row. Lives next to the existing row types in `queries.ts`
or alongside the draft handlers in FinancialsBoard — either fine;
prefer FinancialsBoard since draft is a UI concept, not a queries
concept.

---

## I. What revalidates after a create

Same as Phase 3a: `revalidatePath("/owner/financials")` only.

- No dashboard widget reads financials yet.
- No `/owner/clients/[id]` tab reads income_payments or mileage_logs.
- Other surfaces are deferred until they're built.

No `router.refresh()` on the client side, same as Phase 3a — the
board's optimistic state + the action's returned row are the source
of truth.

---

## J. Risks / surprises

### 1. The `key`-prop fix on FinancialsBoard discards in-progress drafts

`page.tsx:108` sets `key={range === "ytd" ? \`ytd-${yearLabel}\` :
\`month-${monthKey}\`}`. When the user clicks the month-arrow ◀ on
the toolbar mid-draft, the whole board unmounts and remounts with
fresh state. Any partially-filled ghost row is silently lost.

Single-user, single-writer Kelsey is unlikely to do this often.
Three options:
- Accept it (recommended). Document the behavior internally.
- Persist drafts in `sessionStorage` keyed by the month — overkill.
- Confirm-on-leave dialog if a draft is dirty — adds friction with
  no clear win.

Accept it. The current behavior is correct for a fresh "different
range = different dataset" semantic.

### 2. createMileageLogAction needs to read app_settings

The action MUST read `app_settings.mileage_rate_per_mile` at write
time to populate the required `rate_per_mile` column. Today none
of the financials actions read app_settings — only `queries.ts:112-117`
does. New plumbing.

Pattern to copy (inline, don't extract a helper):
```ts
const { data: settings, error: settingsError } = await supabase
  .from("app_settings")
  .select("mileage_rate_per_mile")
  .eq("singleton", true)
  .maybeSingle();
if (settingsError) return { ok: false, error: settingsError.message };
if (!settings) return { ok: false, error: "App settings missing" };
const rate = Number(settings.mileage_rate_per_mile);
```
Mirrors `_lib/queries.ts:112-117` style.

### 3. Display row types are strict; draft rows are loose

`IncomeRow`/`ExpenseRow`/`MileageRow` in `_lib/queries.ts:18-46`
have non-null required fields (e.g. `IncomeRow.clientName: string`).
A draft row can't satisfy these until all required cells are filled.

Solution: separate `DraftXRow` types (Section H). Don't try to make
the existing display row types more permissive — that would
weaken type safety in every Phase 3a code path.

### 4. Sort placement on commit

`_lib/queries.ts:94-95` orders income by `payment_date DESC,
created_at DESC`. When the action returns a new row, naive `[...rows,
newRow]` puts it at the bottom — wrong if its date is recent.
`[newRow, ...rows]` puts it at the top — wrong if its date is older
than the most recent row.

Correct: re-sort after insertion. A small inline sort helper per
table (mirror the server's ORDER BY shape exactly so display matches
a future refresh). Three sort helpers (one per table) live next to
the handlers in FinancialsBoard. Don't extract.

### 5. Auto-focus on a fresh ghost row would be intrusive

The Phase 3a InlineCell auto-focuses the input on edit-mode entry.
If a ghost row mounts with the date cell already in edit mode (so
the user can immediately start typing), the page would load with a
focused input — jarring for someone who's just trying to read the
financials.

**Don't auto-edit ghost cells on mount.** Display them in
display-mode with placeholder text. User clicks/tabs to enter edit
mode. Standard InlineCell behavior, no special-case needed.

### 6. mileage_logs.client_id is on the action's input but no UI

Phase 3a's `UpdateMileageLogInput` doesn't include `client_id`
(intentionally — client cell is read-only). Phase 3b's
`AddMileageLogInput` similarly should NOT include `client_id`;
the action should hardcode `client_id: null` on insert. Same for
`start_odometer` and `end_odometer`. If a future phase wants client
linkage, add it then.

### 7. `notes` on mileage_logs is in the DB but not displayed

`MileageRow` in queries.ts doesn't include `notes`, and `MileageTable`
doesn't have a Notes column. The Phase 3a `UpdateMileageLogInput`
includes `notes` as an unused field. For consistency, Phase 3b's
`AddMileageLogInput` can either:
- Mirror the Phase 3a pattern (accept `notes`, even though UI
  doesn't send it), OR
- Drop it (don't accept what the UI can't supply).

Pick the second. Keeps the input type honest to the actual UI surface.
(The Phase 3a pattern of accepting unused fields was a precedent I
recommended for completeness; on reflection, dropping unused fields
is cleaner.)

### 8. expenses has NO logged_by — diverges from income / mileage

The three create-action signatures will not be symmetrical. Don't
try to make them. Each action takes the input shape that matches its
table.

### 9. The "auto-commit on blur" semantic interacts with cell errors

If a cell has an in-edit-mode error (e.g. invalid date typed), the
row is partially filled but not ready for commit. The next cell-blur
that would trigger auto-commit needs to check "all required fields
are NOT just present but also VALID." Easy to handle: the draft
state stores parsed values (numbers, ISO dates), not raw drafts —
parse on cell-blur, write to draft state if parse succeeds, leave
cell in edit mode with error if parse fails.

This is consistent with the Phase 3a parse-then-commit flow.

---

## K. Recommendations for the Phase 3b build prompt

1. **Visible-during-save (Option A)**: the ghost row stays in place
   while the create action runs (inputs disabled, slight opacity),
   then morphs into a real row using the action's returned record
   (with the server-issued id), and a fresh ghost row appears below.
   Failure leaves the row in draft state with values intact and a
   small inline error. Don't copy the MessageThread tempId-map
   complexity — financials has no polling race.

2. **ID generation**: ``draft-${crypto.randomUUID()}`` for the
   ghost row's React `key`. Mirrors the single existing precedent
   in `components/messages/MessageThread.tsx:372`.

3. **Extend InlineCell, don't fork it**. Make `value` nullable for
   all five types. Add `placeholder?: string` to BaseProps; render
   it in italic + `var(--text-muted)` when display mode and value
   is null. ~20 lines of internal edits. The Phase 3a callers keep
   passing non-null values and never exercise the new path.

4. **Draft state lives in FinancialsBoard**: three new state slots
   (`draftIncomeRow`, `draftExpenseRow`, `draftMileageRow`), each
   `Partial<DraftXRow> | null`. Board exposes per-table
   `onDraftFieldChange(field, value)` and `onDraftCommit()`
   callbacks. Tables stay thin. Mirrors the Phase 3a separation.

5. **Auto-commit on blur** once all required cells are validly
   populated. Surface a small "Saving…" indicator at the row-actions
   cell during the in-flight action. On success, a fresh ghost
   appears below — that's the commitment signal. No explicit "Add"
   button (would break the spreadsheet feel).

6. **Three new actions**: `addIncomePaymentAction`,
   `addExpenseAction`, `addMileageLogAction`. Each mirrors
   `addTimeLogAction` (`app/owner/clients/_actions.ts:34-70`) for
   shape: typed `AddXInput` interface, `requireOwner` guard, field
   validation, `.insert(...).select("*").single()`,
   `revalidatePath("/owner/financials")`, return
   `ActionResult<XRecord>` with the row in `data`. No reuse from
   Phase 3a's update actions — insert and update are fundamentally
   different operations.

7. **`addMileageLogAction` reads `app_settings.mileage_rate_per_mile`
   at write time** to populate the required `rate_per_mile` column.
   Inline pattern from `_lib/queries.ts:112-117`; don't extract a
   helper.

8. **Don't auto-focus ghost cells on mount.** Display them in
   display-mode with placeholder text. The page should load looking
   identical to Phase 3a, just with an extra row of "Add…" cells at
   the bottom of each table.

### Things to push back on or split out

- **No "confirm on leave" or sessionStorage-persist for in-progress
  drafts**. The `key`-prop fix from yesterday is correct: navigating
  the toolbar discards the draft. Document but don't engineer around.
- **Don't add a row-level commit indicator beyond "Saving…"**. The
  "fresh ghost appears below" is the success signal. No toast, no
  banner, no flash.
- **Don't include `notes` in `AddMileageLogInput`** even though the
  Phase 3a Update version has it. The MileageTable has no notes
  column. Keep the input honest to the UI.
- **Don't ship client-FK resolution for income or mileage.** The
  spec defers this; honor it. Income's `client_name_snapshot` is
  free-text and `client_id` stays null. Mileage's `client_id`
  stays null (no UI to select).
- **Don't ship receipt_url upload for expenses.** Out of scope.
  `expenses.receipt_url` stays null.
- **Don't ship start_odometer / end_odometer for mileage.** Out of
  scope. Both columns stay null.
- **Don't try to debounce auto-commit.** The blur-fires-when-required-
  complete heuristic is enough; debouncing adds latency without
  removing a real failure mode.

---

### A small revision to one Phase 3a recommendation

In the Phase 3a audit I recommended accepting unused fields
(`client_name_snapshot` on income, `notes` on mileage) in the Update
input types "for completeness." Phase 3b is a good moment to revisit:
the cleaner stance is **input types match the UI surface**. For 3b,
Add input types should NOT include fields the ghost row doesn't
expose. For consistency, consider tightening the 3a Update types
the same way in a tiny follow-up — out of scope here, just flagging.
