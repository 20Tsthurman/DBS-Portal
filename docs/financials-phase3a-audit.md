# Phase 3a Audit — Financials Inline-Edit (Existing Rows)

Read-only inventory of patterns, primitives, and risks before any feature
code is written. Scope: turn the three read-only tables on
`/owner/financials` into spreadsheet-style edit-in-place surfaces for
EXISTING rows. New-row creation is Phase 3b and not covered here.

---

## A. Server action conventions for update + delete

### Canonical update-row action shape

The codebase has two canonical update shapes; both are valid prior art.

**1. Patch object with merge-and-validate** — best fit for Phase 3a:
- `updateShoot(shootId, updates: UpdateShootInput)` at
  `app/owner/shoots/_actions.ts:120-219`.
- `updateTimeBlock(blockId, updates: UpdateTimeBlockInput)` at
  `app/owner/calendar/_actions.ts:124-197`.

Skeleton:
```ts
export type UpdateShootInput = Partial<CreateShootInput>;

export async function updateShoot(
  shootId: string,
  updates: UpdateShootInput
): Promise<ActionResult<ShootRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!shootId) return { ok: false, error: "Missing shoot id" };

  // 1. validate each present field
  if (updates.status !== undefined && !VALID_STATUSES.includes(updates.status)) {
    return { ok: false, error: "Invalid status" };
  }
  // 2. build the patch — only keys that were supplied
  const patch: Record<string, unknown> = {};
  if (updates.scheduledAt !== undefined) patch.scheduled_at = updates.scheduledAt;
  // …
  // 3. write
  const { data, error } = await supabase
    .from("shoots").update(patch).eq("id", shootId).select("*").single();
  if (error || !data) return { ok: false, error: error?.message ?? "…" };
  // 4. revalidate
  revalidateShootPaths((data as ShootRecord).client_id);
  return { ok: true, data: data as ShootRecord };
}
```

**2. Single-field, no patch object** — for cases where a row has one
editable field, the action takes the value directly. Example:
`updateNotesAction({ clientId, notes })` at
`app/owner/clients/_actions.ts:93-131` (single-field update on a
projects row, identified by `client_id` not by `id`).

### Canonical delete-row action shape

`deleteTimeLogAction(logId, clientId)` at
`app/owner/clients/_actions.ts:72-86`:
```ts
export async function deleteTimeLogAction(
  logId: string,
  clientId: string
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("time_logs").delete().eq("id", logId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/owner/clients/${clientId}`);
  revalidatePath("/owner/clients");
  return { ok: true };
}
```

`deleteShoot(shootId)` at `app/owner/shoots/_actions.ts:239-261` is a
richer variant: it does a pre-lookup to grab `client_id` for the
revalidate call. For Phase 3a, none of the three financial tables need
a per-client revalidate (the page is `/owner/financials` only), so the
shorter `deleteTimeLogAction` shape is the better template.

### `ActionResult` shape

Re-declared in each `_actions.ts` file (not centralized). Identical
everywhere:
```ts
export interface ActionResult<T = null> {
  ok: boolean;
  error?: string;
  data?: T;
}
```
Sample sites: `app/owner/clients/_actions.ts:28-32`,
`app/owner/shoots/_actions.ts:23-27`, `app/owner/calendar/_actions.ts:11-15`,
`app/owner/time/_actions.ts:10-14`.

### Partial-update support today

Both update patterns are present:
- **Full patch object** (`Partial<CreateInput>`) — `updateShoot`,
  `updateTimeBlock`. Each `_actions.ts` defines `UpdateXInput =
  Partial<CreateXInput>` and conditionally adds keys to a `patch`
  object. This handles arbitrary field-level edits in one round-trip.
- **Single-field, dedicated action** — `updateNotesAction` (one field
  per action). Used when only one column is ever edited.

For Phase 3a inline edit, the **patch-object shape is the better fit**
even though most edits will touch one field at a time: a tab through
several cells in one row could plausibly batch, and the patch shape
costs essentially nothing more than a single-field action.

### Server actions called from non-form contexts

Yes. Several precedents, not from `onBlur` specifically but from
non-form click handlers — equivalent ceremony:

- `app/owner/shoots/_components/ShootRowActions.tsx:60-67,80-88` —
  status changes and delete fire `startTransition(async () => { … })`
  from a menu button click, not a form submit.
- `app/owner/calendar/_components/PendingRequestActions.tsx:36-57` —
  `runAction` is an async function called from a ConfirmDialog's
  `onConfirm`, again no form involved.
- `app/owner/clients/[id]/_components/NotesTab.tsx:45-59` — `handleBlur`
  on a `<textarea>` fires `updateNotesAction` inside
  `startTransition`. **This is the closest existing precedent to a
  blur-commits-edit flow** and is worth modeling Phase 3a's commit
  behavior on directly.

Pattern: `useTransition()` wrapping the async call, local `error`
state for failure surfacing, `router.refresh()` (or omit if the page
state is fully controlled client-side).

---

## B. Optimistic UI patterns

### React's `useOptimistic`

**Not used anywhere in the codebase.** Grep across the full repo for
`useOptimistic` returns 0 hits. Every "feels immediate" interaction is
hand-rolled with `useTransition` + local state.

### Existing "edit immediately, roll back on error" precedent

The single best analog is `app/owner/clients/[id]/_components/NotesTab.tsx`:

- Local `value` state holds the user's typed text (line 34).
- `lastSavedValue` ref holds the last server-confirmed value (line 38).
- On blur, if `value !== lastSavedValue.current`, start a transition,
  call the action, and only update `lastSavedValue` on success (line
  56). On failure, the error renders next to the "Saving…" indicator
  (line 79) and `value` is left in its edited state — there is no
  automatic snap-back to the prior server value. The user sees the
  error and can re-edit.

This is *implicit* optimism: the displayed value is the user's edit,
not the server value, and stays that way until the next prop change.
For Phase 3a, a true rollback (revert display to prior value on
failure) requires explicitly resetting `value` from a snapshot, which
no current component does — it would be the first.

The second pattern, `QuickLogForm`
(`app/owner/time/_components/QuickLogForm.tsx`), is a create-form, not
edit. Useful only for: success-flash UI (`SUCCESS_FADE_MS = 4000`,
lines 35, 144-151) and the snapshot-the-current-name-for-the-message
trick (lines 124-126).

### Pending state visual treatment

Consistent across the codebase:
- **Disabling** the affected control: `disabled={isPending}` on
  buttons (TimeTab.tsx:140-141) and form inputs (QuickLogForm.tsx:168,
  191, 209, 226, 245).
- **Opacity 0.6 + cursor not-allowed** on buttons: applied via inline
  style ternaries (ShootRowActions.tsx:115; ConfirmDialog.tsx:77-78).
- **Label swap** on a single primary button: `"Saving…"` / `"Working…"`
  / `"Logging…"` while pending (TimeTab.tsx:295; ClientFormPanel.tsx:273;
  QuickLogForm.tsx:272; ConfirmDialog.tsx:94).
- **No spinners** anywhere — no `<Spinner>` component exists in
  `components/`.
- **No row-level dim** — no precedent for "this entire row is in flight."

For Phase 3a, the cleanest in-codebase choice for an edit-in-flight
cell would be subtle: keep the input editable, leave the new value
displayed, optionally a thin border-color shift or a "Saving…" inline
hint — but there is no existing precedent to copy verbatim. Stay
minimal.

### Concrete cite for "best existing pattern"

`NotesTab.tsx` — both the blur-to-commit flow AND the
last-saved-value tracking are reusable verbatim. The only thing it
doesn't model is multi-cell-in-flight concurrency (Section H).

---

## C. Toast / error surfacing

### No global toast system

Grep for `toast`/`Toast` across the repo returns **zero** matches in
source files. Every page handles its own error surfacing inline.

### Existing inline-error idioms

Two canonical shapes:

**1. Banner block inside a form** — the styled "panel" version.
Defined in `app/owner/clients/_components/formStyles.ts:28-35`:
```ts
export const errorStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  border: "1px solid var(--status-danger)",
  background: "rgba(122,48,64,0.08)",
  color: "var(--status-danger)",
  fontSize: "13px",
};
```
Used by TimeTab, ClientFormPanel, ShootFormPanel. Looks like a
recessed alert.

**2. Lightweight inline text** — single-line danger-colored paragraph.
- QuickLogForm: `color: var(--status-danger), fontSize: 13` (lines
  279-283).
- NotesTab: `color: var(--status-danger), fontSize: 12` next to the
  "Saved at" timestamp (lines 79-80).
- PendingRequestActions: tiny `fontSize: 11` for inline pending-action
  errors (`errorStyle` const at lines 196-200).

**3. `alert()` for after-the-fact action failures** —
ShootRowActions.tsx:63, 83 falls back to `alert(...)`. Fine for rare
errors on a menu-driven action, BAD precedent for a high-cadence
spreadsheet flow.

### Best precedent for multiple-edits-in-flight

There isn't one. Every existing edit surface either:
- Only allows one in-flight operation at a time (the form is the
  whole UI), or
- Uses one shared error string that gets overwritten by the next
  failure.

Phase 3a will be the first place where 2+ cell-level errors could be
"live" simultaneously. The most natural fit, staying close to existing
style:
- **Per-row, per-cell**: render the failing cell with a border-color
  change to `var(--status-danger)` and a title/aria-label carrying
  the error message. No banner. Simple, scales to N cells, doesn't
  obstruct the table.
- **Plus** a top-of-page banner (errorStyle shape) ONLY when the row
  itself disappears (delete failure) — because there's no cell left
  to attach the message to.

This is opinionated and not directly copied from anywhere; it is the
smallest extension of existing patterns.

---

## D. Client-component patterns for tables

### Existing table approach

All tables in the portal are **hand-rolled `<table>` markup**, no
generic Table primitive. Confirmed sites:
- `app/owner/clients/page.tsx` (server-rendered).
- `app/owner/shoots/page.tsx` (server-rendered).
- `app/owner/financials/page.tsx:218-317` (server-rendered, current).
- `app/owner/clients/[id]/_components/TimeTab.tsx:117-159` (client
  component — the table is INSIDE the `"use client"` boundary).

### Boundary precedent: TimeTab.tsx

This is the closest analog to Phase 3a today. **The entire tab is one
`"use client"` component**: the table, the per-row delete buttons, the
totals summary, and the SlidePanel form. It receives `initialLogs:
TimeLogRecord[]` as a prop (line 23) and re-reads them through
`router.refresh()` after a write.

Notable: there is NO server-rendered wrapper with client-only buttons
injected. The whole list is client-side.

### Shoots page — the other boundary precedent

`/owner/shoots` (haven't shown above but consistent with `ShootRowActions`
being a `"use client"` component) is server-rendered for the table
body, with `<ShootRowActions />` embedded per row as a `"use client"`
island. That's the hybrid shape.

### Recommendation for Phase 3a

The page has three independent tables (Income, Expense, Mileage) plus
a Summary card that must recompute live. Three options scored against
the codebase:

1. **Server page + three `"use client"` table components** (each
   receives `initialRows`). The Summary card stays inside a "use
   client" wrapper that holds the union of the three current
   row-arrays and recomputes locally. This is the **closest fit to
   the TimeTab pattern**, requires no rewrite of the toolbar or URL
   contract, and keeps the heavy timezone math + Supabase fetch in
   the server component (`page.tsx`).
2. **Whole page client** — would require lifting the URL→range math
   and Supabase fetch into a route handler or a useEffect on mount.
   Goes against every other owner page. Skip.
3. **Hybrid (server-rendered rows, "use client" cells)** — Next 15
   does support a client cell embedded inside a server `<tr>`, but
   each cell would need to hold its own state AND tell the Summary
   card it changed. Synchronizing N cells back up to a shared
   summary across the server/client boundary is much more wiring than
   option 1.

**Pick option 1.** The page remains a server component; three sibling
"use client" components are the tables. A small parent "use client"
container (could be the page itself promoted, or — better — a
`<FinancialsBoard initial={data} />` client wrapper) holds the three
row arrays in `useState`, passes setters down to each table, and
recomputes the Summary card locally.

---

## E. Form/input styling

### Shared input primitives

Centralized in `app/owner/clients/_components/formStyles.ts`:
- `fieldStyle` — `width:100%, border:1px solid var(--border),
  background:#fff, padding:8px 12px, fontSize:14, color:var(--text-primary),
  outline:none`.
- `labelStyle` — `fontSize:11, letterSpacing:0.14em, textTransform:
  uppercase, color:var(--text-body), marginBottom:6, fontWeight:600`.
- `applyFocus` / `clearFocus` — borderColor swap on focus
  (var(--accent) ↔ var(--border)).
- `errorStyle` — see Section C.

Consumed by every form on the owner side EXCEPT `QuickLogForm`, which
duplicates the styles inline (`app/owner/time/_components/QuickLogForm.tsx:37-68`)
— a pre-existing inconsistency, not blocking.

### Sizing reference

Inputs ship at:
- Height: implicit ~36px (8+12+8 padding + 14px line).
- Border: 1px solid var(--border).
- Background: #FFFFFF.
- Focus: borderColor switches to var(--accent) via `applyFocus`.

The financials tables currently render bare text in `<td>`s; there is
no per-cell styling beyond inherited table styles + a `.row-hover`
class (page.tsx:183) and inline `textAlign: "right"` on amount columns
(page.tsx:226, 239, 259, 271, etc.).

### Inline-edit visual precedent

**There isn't one.** No cell in any existing table becomes an input.
The closest experience is NotesTab's `<textarea>`, which is a
permanently-rendered input, not a cell-becomes-input transition.

Recommendation for Phase 3a: build a single small `<InlineCell>`
primitive that:
- In display mode renders the formatted value inside the `<td>` (uses
  current `formatCurrency` / `formatDate` / enum-label mapping).
- On click/focus, swaps in an input element styled with `fieldStyle`
  MINUS the `width:100%` and with `padding:6px 8px` (so the row
  height doesn't jump). Border on focus stays var(--accent).
- Reverts to display mode after commit/revert.

Keep it visually quiet — no chrome change when display-mode, faint
border on hover to hint at editability.

---

## F. Validation patterns

### Where validation lives today

**Both client and server**, but server is always the authority:

- **Client-side**: synchronous checks before `startTransition` fires.
  Examples: `TimeTab.tsx:64-68` (`parseFloat(hours)`,
  `parsedHours <= 0` check); `QuickLogForm.tsx:109-119` (multi-field
  required check); `ClientFormPanel.tsx:70-77` (name + email).
- **Server-side**: every action re-validates everything. Examples:
  `addTimeLogAction` validates hours range and category enum
  (`app/owner/clients/_actions.ts:40-47`); `updateShoot` validates
  status, kind, meetingType (lines 128-149).

There is no shared `validate` helper — each action hand-rolls its
checks.

### Monetary input parsing

**No existing helper for parsing money strings.** Every form that
takes a number uses `<input type="number">` with `min`/`step`
attributes and `Number(value)` to parse. Examples:
TimeTab.tsx:64 (`Number(hours)`), QuickLogForm.tsx:109
(`Number(hours)`). Phase 3a's requirement to accept `"45"`, `"$45"`,
`"45.00"` and reject non-numeric without committing is genuinely new
work — there is no `parseMoney(s: string): number | null` in the
codebase.

For Phase 3a, the spec calls for a `<input type="text">` (not
`number`) so that the `$` prefix can be typed. The parser should be a
small local helper:
- strip leading `$` and whitespace,
- `Number(stripped)`,
- if `!Number.isFinite(n) || n <= 0`, reject (don't commit, hold
  edit mode).

Mirrors the server-side check at `app/owner/clients/_actions.ts:43`
in style.

### Date validation

Everywhere, `<input type="date">` is used and the browser hands back
`YYYY-MM-DD`. The server actions then accept that string directly into
a Postgres `date` column (see `addTimeLogAction` — no parsing). Schema
columns are `date not null` (income_payments.payment_date,
expenses.date, mileage_logs.trip_date). Use `<input type="date">` for
the date cells — no extra validation needed.

`isValidDate` exists at `app/owner/calendar/_actions.ts:38-41` for a
defensive server-side regex check. Worth mirroring in the new
financial actions.

---

## G. Revalidation behavior

### What `addTimeLogAction` revalidates

```ts
revalidatePath(`/owner/clients/${input.clientId}`);
revalidatePath("/owner/clients");
```
(`app/owner/clients/_actions.ts:67-68`)

`deleteTimeLogAction` revalidates the same two paths
(lines 83-84).

### What Phase 3a should revalidate

After an edit to any of the three financial tables:
- **`/owner/financials`** — yes.
- **`/owner/dashboard`** — currently no dashboard widget reads
  financials. Safe to skip until/unless that changes. (Phase 2 audit
  Section 12 mentions a hypothetical expenses widget on the dashboard;
  defer until it exists.)
- **`/owner/clients/[id]`** — *maybe*: income_payments and mileage_logs
  carry `client_id`. If a client-detail tab ever reads them
  (none currently does), this would matter. Safe to skip for Phase 3a.

So Phase 3a actions only need `revalidatePath("/owner/financials")`.

### Revalidate without a full rerender?

Key insight: `revalidatePath` does NOT force the current page to
remount. It invalidates the cache so the **next navigation** to that
path will refetch. Inside `useTransition`, the in-flight `await
serverAction()` resolves, and the optimistic state stays untouched.
The reason existing components call `router.refresh()` (TimeTab,
QuickLogForm, ShootRowActions, PendingRequestActions) is to **force**
a re-render with fresh server data — for surfaces where the local
state isn't a complete picture of the row list (e.g., TimeTab needs
the totals recomputed from a fresh fetch).

**For Phase 3a, do NOT call `router.refresh()` after edits.** The
client state is authoritative for the duration of the session: the
edited values are already what the user sees, and forcing a refresh
would snap the in-flight state back to whatever the latest server read
returned, defeating the optimistic feel. Only call `revalidatePath`
on the server so a fresh nav into `/owner/financials` later picks up
the changes.

(Exception: delete. After a row delete, the client removes the row
optimistically; if the server returns success, no refresh needed; if
it fails, restore the row and surface the error.)

---

## H. Concurrency hazards

### Multiple cells in flight at once

**No existing precedent.** Every component in the codebase that
mutates uses a single `useTransition()` — `isPending` is a single
boolean for the whole component. If Phase 3a uses one shared
transition, then editing cell B while cell A is still saving causes B
to wait, which kills the spreadsheet feel.

Two viable approaches:
1. **One `useTransition` per cell** (i.e., the `<InlineCell>` owns its
   own pending state). Each cell's request is independent; ordering
   across different cells doesn't matter because they touch different
   columns.
2. **A request queue per row** — only needed if two edits to the SAME
   field on the same row could race. With single-user Kelsey usage,
   that's vanishingly unlikely. Skip.

Pick approach 1. It's also what makes "Tab through 5 cells in 2
seconds" actually responsive.

### Edit in tab A while tab B reads stale data

The portal does not push live updates anywhere except messages
(useVisibilityPolling, see below). Other tabs see stale data until
next nav. Phase 3a inherits that behavior — no change needed.

### useVisibilityPolling relevance

`lib/hooks/useVisibilityPolling.ts` is a messages-stack hook. It
polls a fetcher on a visibility-gated interval and fires on a
custom `invalidationEvent`. **It is unused outside messages** (grep
confirms it's imported only by message components, judging by the
hook's doc-comment that names "messages stack" specifically).

Phase 3a does not need polling. Financials is a personal-bookkeeping
surface; Kelsey is the only writer. Skip polling entirely.

---

## I. Risks / surprises

### 1. **BLOCKING — `expenses.category` CHECK constraint is stale**

`supabase/schema.sql:141` still has:
```sql
check (category in ('equipment', 'software', 'travel', 'marketing', 'meals', 'other'))
```

But `lib/supabase.ts:18-24` and `app/owner/financials/_lib/queries.ts:72-79`
define and use the new enum:
```ts
'platform_software' | 'marketing_advertising' | 'equipment_gear' |
'travel_transportation' | 'professional_services' | 'business_operations'
```

Note: `supabase/schema.sql` is in your unstaged changes
(see `git status`). It's possible the constraint update is part of
the in-progress edits. **Verify before Phase 3a starts** —
if the running database still has the old CHECK, then:
- Any existing `expenses` rows use the old enum values; Phase 3a's
  `<select>` of new labels would let Kelsey pick a value that the DB
  rejects.
- Inserting a row with a new value would fail with a CHECK violation.

The `recurring_expense_templates` table (lines 293-302) is already
on the new enum. The `expenses` table needs the same migration before
Phase 3a's category dropdown can ship.

### 2. `mileage_logs` has no `client_name_snapshot`

`income_payments` carries `client_name_snapshot` (used at display time
in `queries.ts:151`). `mileage_logs` does not — it has only
`client_id`, and the display name is resolved via a second query in
`queries.ts:189-209`. For inline-edit, editing the Client cell on a
mileage row means showing a `<select>` of all clients. That select
needs the client list, which `page.tsx` doesn't currently fetch.

Either:
- The new `<MileageTable>` client component receives `clients:
  Pick<ClientRecord, "id" | "name">[]` as an additional prop, OR
- Mileage Client cell is read-only in Phase 3a (only the address and
  miles cells are editable).

The plan says all cells editable. Plan for the extra prop.

### 3. `income_payments.client_name_snapshot` vs `client_id`

The income table has both a snapshot and an FK. Today's read path
shows `client_name_snapshot` only (`queries.ts:151`). Should Phase 3a
let Kelsey edit the client?
- If yes: the action needs to update BOTH `client_id` (resolved from
  the picker) AND `client_name_snapshot` (the display value). Forget
  one and the row goes inconsistent.
- If no: the Client cell is read-only — but then a typo in a snapshot
  is uncorrectable inline, which contradicts the spreadsheet feel.

Recommendation: editable, action takes a `clientId | null` (with
`null` for "no client"), looks up the name server-side, writes both
columns atomically. Document the pairing in the action.

### 4. Mileage rate column is documented as not-editable, but…

The plan correctly excludes rate-per-mile from inline edit. Good —
the rate is a snapshot from `app_settings`
(`mileage_logs.rate_per_mile`). However, the `<MileageTable>` also
displays a computed `deduction` column (`queries.ts:221`). The plan
says "Mileage deduction is computed, also not editable." Correct, but
the implementation has to recompute it client-side after `miles`
edits so the Summary card stays accurate. Don't refetch — compute
`miles * ratePerMile` in the client component.

### 5. Summary card recompute scope

The Summary card includes Mileage deduction in `Total Expenses`
(`queries.ts:232`). Editing a mileage row's `miles` value changes
both `Total Mileage Deduction` (implicitly via the row) and
`Total Expenses` and `Net Profit` and `Tax Set-Aside` and `Take-Home`.
The recompute formula is at `queries.ts:229-235`:
```
expensesFromTable = sum(expense rows)
mileageDeduction = sum(miles * ratePerMile)
expenses = expensesFromTable + mileageDeduction
netProfit = income - expenses
taxSetAside = netProfit > 0 ? netProfit * (taxRatePercent/100) : 0
takeHome = netProfit - taxSetAside
```
Lift this exact formula into a client-side `recomputeSummary(rows,
taxRatePercent)` helper and call it whenever a row changes. The
server-side function in `queries.ts` is the source of truth — the
client helper must mirror it bit-for-bit (otherwise the moment Kelsey
edits a row the Summary differs from what a re-fetch would show).
`taxRatePercent` needs to be threaded through from page.tsx as a prop
(it's currently buried inside the returned `summary`).

### 6. No existing CHECK on `expenses.amount`

`supabase/schema.sql:143` declares `amount numeric not null` with no
positive-only check. `income_payments.amount` (line 247) has
`check (amount > 0)`. `mileage_logs.miles` (line 278) has
`check (miles > 0)`. So a Phase 3a expense edit could accept 0 or
negative without the DB pushing back. The client validation must
catch this (mirror `amount > 0` from the income action shape).

### 7. URL contract is intact

`page.tsx` reads `month` and `range` from searchParams and passes
them into the toolbar. Promoting the page (or a sibling wrapper) to a
client component does not need to change the URL contract — the page
remains a server component, computes `fetchRange`, awaits
`fetchFinancialsForRange`, and passes the result down to the new
`<FinancialsBoard initial={…} taxRatePercent={…} />` client wrapper.
No router prop drilling needed for the toolbar (toolbar can stay a
server component; the tables wrap below it).

### 8. Three identical action triplets vs one generic

The action layer for Phase 3a needs an update + delete per table —
six new actions total (`updateIncomePayment`, `deleteIncomePayment`,
`updateExpense`, `deleteExpense`, `updateMileageLog`,
`deleteMileageLog`). Tempting to abstract into a generic
`updateFinancialRow(table, id, patch)`. Don't. Each table has a
distinct typed input (different enums, different fields), and the
existing codebase has never abstracted across tables — `updateShoot`
and `updateTimeBlock` are siblings, not derived from a base. Stay
consistent.

---

## J. Recommendations for the Phase 3a build prompt

1. **Table split**: server-component page + a single
   `"use client" <FinancialsBoard initial={data} taxRatePercent={n} />`
   wrapper that owns the three row arrays and the recomputed Summary.
   Three sibling table components (`<IncomeTable>`, `<ExpenseTable>`,
   `<MileageTable>`) receive `rows` + `setRows` (or `onChange`) and
   render the cells. Toolbar stays a server component, page stays a
   server component, URL contract untouched.

2. **Stay with `useTransition`, not `useOptimistic`.** The codebase
   has zero `useOptimistic` precedent and a clear `useTransition` +
   snapshot-ref pattern (NotesTab.tsx). Introducing `useOptimistic`
   here would be a one-off and offers no real win for single-user,
   single-writer Financials. Each `<InlineCell>` owns its own
   `useTransition` so cell edits don't queue.

3. **Build a shared `<InlineCell>` primitive.** Don't hand-roll
   per-table. The display↔edit transition, focus/blur commit, Tab/
   Enter/Esc handling, and per-cell pending+error state are all
   common. Variants by type:
   `<InlineCell type="date" | "money" | "text" | "enum" />` with
   `options` for enum and `placeholder` for nullable text. Live
   beside the tables, not in `components/ui/` (matches `formStyles.ts`
   being co-located with the forms that use it).

4. **Action shape: per-table patch object.** Six actions total —
   `updateIncomePayment(id, updates: Partial<IncomePaymentInput>)`
   and `deleteIncomePayment(id)` per table. Mirror `updateShoot`
   exactly. Don't generalize across tables.

5. **Delete UX: keep `ConfirmDialog`, but reconsider.** The plan
   specifies ConfirmDialog. It's appropriate for irreversible deletes
   AND it's already the in-codebase pattern for destructive shoot
   actions (PendingRequestActions.tsx, ShootRowActions.tsx).
   Counter-argument: a spreadsheet feel often allows row-level undo
   instead. But undo infrastructure doesn't exist here, and adding it
   is out-of-scope for 3a. **Keep ConfirmDialog.** When 3b lands the
   ghost row, an undo affordance can be revisited.

6. **DO NOT call `router.refresh()` after edits.** Only call
   `revalidatePath("/owner/financials")` server-side. The Summary
   card recomputes from client state, not from a re-fetch.
   `router.refresh()` is fine on delete failure only if it's the
   simplest restore path — but a snapshot-and-restore in client state
   is cleaner.

7. **Cuts / splits worth pushing back on the plan for:**
   - **Resolve the expenses-table CHECK constraint mismatch BEFORE
     Phase 3a** (Risk #1). If `supabase/schema.sql` in your unstaged
     changes already fixes it, apply that migration and confirm
     against the running DB. If not, fix it first. Either way,
     Phase 3a cannot ship a category select that the DB will reject.
   - **Mileage Client cell scope**: decide explicitly whether it's
     editable in 3a. If yes, the page must additionally fetch the
     full client list (`SELECT id, name FROM clients`) and thread it
     down to `<MileageTable>`. Plan doesn't currently call this out.
   - **Income Client cell coupling**: editing client requires writing
     both `client_id` and `client_name_snapshot` atomically. Action
     should resolve the name server-side, not trust a client-supplied
     pair (Risk #3).
   - The plan's "blur commits" rule needs an explicit carve-out for
     "blur to another cell in the same row should NOT commit twice."
     Use the NotesTab pattern: compare to a per-cell `lastCommitted`
     ref before firing the action.
