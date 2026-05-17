# Settings & Cascade Audit — Pre-build

Read-only reconnaissance for the two follow-up gaps surfaced after the
Phase 4 financials Round 1 cleanup:

1. **GAP 1 — Client deletion behavior.** Schema FKs hard-delete five
   child tables when a client is deleted; for a service business that
   bills by hours, losing `time_logs` on client deletion is a real
   tax-audit risk. Goal: confirm that hard-delete is never exposed in
   the UI today.
2. **GAP 2 — No UI for `recurring_expense_templates` or `app_settings`.**
   The Phase 4 suggestion-consumer for templates exists; the
   producer/admin UI does not. The seeded `home_address`,
   `mileage_rate_per_mile`, and `tax_set_aside_percent` settings have
   no editor either.

Cited at file:line throughout; no code modified.

---

## 1. Client deletion surface

### 1a. Code-path inventory

**No `deleteClientAction`, `removeClientAction`, `destroyClient*`, or
any in-server-actions delete handler exists anywhere in the repo.**
Greps for `deleteClient | removeClient | destroyClient |
deactivateClient | archiveClient` returned zero matches across all
`*.ts/tsx/js/jsx` files. Similarly, `.from("clients").delete()` returns
zero matches. The only `.from("clients")` call sites are reads,
inserts, or status updates — no hard delete is reachable from app
code today.

The only client-mutation endpoint with delete semantics is the API
route handler at `app/api/clients/[id]/route.ts:175-211`:

```ts
export async function DELETE(_request, context) {
  // …auth + id parse…
  const { data, error } = await supabase
    .from("clients")
    .update({ status: "inactive" })   // ← soft delete
    .eq("id", id)
    .select("*")
    .single();
  // …error handling…
  if (deactivated.clerk_user_id) {
    await tryBanClerkUser(deactivated.clerk_user_id);
  }
  return NextResponse.json({ client: deactivated });
}
```

**This is already a soft-delete handler.** Despite the HTTP verb name,
it (1) flips `status` to `'inactive'` and (2) best-effort bans the
Clerk user. The Postgres `DELETE FROM clients` cascade chain is never
triggered.

### 1b. UI surface — is there a "Delete client" button?

**No.** The only client mutation UIs are:

- `app/owner/clients/_components/AddClientButton.tsx` — opens add panel.
- `app/owner/clients/[id]/_components/EditClientButton.tsx:23-34` —
  opens the edit panel; no delete button on the detail page header
  (`app/owner/clients/[id]/page.tsx:157-167`).
- `app/owner/clients/_components/ClientFormPanel.tsx` — add/edit
  form. The status field at `:240-261` exposes a `<select>` with all
  four `ClientStatus` values (`lead`, `onboarding`, `active`,
  `inactive`).

The closest thing to a delete affordance is "Status → Inactive" in the
edit form's dropdown (`:259`). Saving the form fires a PATCH
(`:110-120`) → `app/api/clients/[id]/route.ts:54-173`.

### 1c. PATCH-to-inactive: the Clerk-ban gap

**Finding (subtle bug):** Picking *Inactive* in the edit form does
NOT ban the Clerk user. The PATCH handler at
`app/api/clients/[id]/route.ts:108-119` accepts the `status` field
and writes it through. The follow-up Clerk action at `:160-170` only
fires for the reverse transition (**inactive → not-inactive**, to
unban). There is no symmetric **not-inactive → inactive** branch that
calls `tryBanClerkUser`.

So today:
- DELETE handler → soft-deletes (sets status='inactive') AND bans Clerk
  user. **No UI calls this endpoint.**
- PATCH handler with `status: 'inactive'` → sets status but leaves the
  Clerk user un-banned, meaning a deactivated client could still log
  in.

This is a discoverable bug for any Kelsey who uses the "Inactive"
option in the dropdown today. Two fixes possible:
- Mirror the PATCH ban logic against `prior.status !== "inactive" &&
  updated.status === "inactive"` (symmetric to the unban branch).
- Or: remove `"inactive"` from the form dropdown and require a
  dedicated "Deactivate Client" button that hits the DELETE endpoint.

Either way, the audit's headline answer is unchanged: **no hard-delete
path exists in the UI or API today.** The cascade FKs are theoretical
risks, not active ones.

### 1d. `clients.status` enum usage

Schema (`supabase/schema.sql:16`): `check (status in ('active',
'onboarding', 'inactive', 'lead'))`, default `'onboarding'`.

Type (`lib/supabase.ts:4`): `ClientStatus = "active" | "onboarding" |
"inactive" | "lead"`.

Status filter coverage across surfaces:

| Surface | File:line | Filter | Verdict |
|---|---|---|---|
| Dashboard — `ClientRosterWidget` | `app/owner/dashboard/_components/ClientRosterWidget.tsx:17` | `status !== "inactive"` (then derives `active`, `onboarding`, `lead` counts and an active+onboarding billing pool) | Inactive excluded |
| Dashboard — `BudgetStatusWidget` | `app/owner/dashboard/_components/BudgetStatusWidget.tsx:45-51` | `(status === "active" \|\| "onboarding") && pkg && pkg.monthly_hours > 0` | Inactive excluded |
| Messages inbox query | `app/owner/messages/_lib/queries.ts:102` | `.neq("status", "inactive")` | Inactive excluded |
| Cron — unread reminders | `app/api/cron/unread-reminders/route.ts:83` | `.neq("status", "inactive")` | Inactive excluded |
| Financials — income suggestions | `app/owner/financials/_lib/suggestions.ts:141-148` | `client.type === "brand" && (status === "active" \|\| "onboarding") && pkg && pkg.monthly_price > 0` | Inactive excluded |
| Financials — mileage suggestions | `app/owner/financials/_lib/suggestions.ts:284-296` | No client-status filter (filters past, non-cancelled shoots with locations) | **See note** |
| Calendar pending requests query | `app/owner/calendar/_lib/queries.ts:190` | `.eq("status", "requested")` — this is the *shoot* status, not the *client* status | n/a |
| Clients list page | `app/owner/clients/page.tsx:19-122` | No status filter — renders the full roster including inactive (their pill renders red via `clientStatusTone === "danger"`, `format.ts:72-73`) | Intentional |
| Client detail page | `app/owner/clients/[id]/page.tsx:41-173` | No status filter — accessible by direct URL | Intentional |

**Note on mileage suggestions:** the function doesn't filter by
client status, only by shoot attributes (past, non-cancelled,
location-present). For a client who has been deactivated *after* a
past shoot, the mileage suggestion would still surface. This is
appropriate: the trip happened, the deduction is real, the client
relationship's current status doesn't change the historical fact.
Mileage_logs.client_id is `on delete set null`
(`supabase/schema.sql:279`), so even a hypothetical hard-delete
wouldn't break this flow.

### 1e. Cascade map (current state)

For reference, the FK behavior on `clients(id)` deletion:

**On delete CASCADE** (rows disappear):
- `projects.client_id` (`schema.sql:60`) — and its grandchild
  cascades onto `shoots.project_id` (`:77` set null) and any
  package_id (`:61` set null).
- `shoots.client_id` (`schema.sql:76`).
- `time_logs.client_id` (`schema.sql:106`).
- `invoices.client_id` (`schema.sql:123`).
- `messages.client_id` (`schema.sql:157`).
- `files.client_id` (`schema.sql:172`).

**On delete SET NULL** (rows survive, FK is nulled):
- `time_blocks.client_id` (`schema.sql:204`).
- `income_payments.client_id` (`schema.sql:243`) — preserved by
  `client_name_snapshot` (`:244`).
- `mileage_logs.client_id` (`schema.sql:279`).

If a hard-delete path were ever introduced, `time_logs` is the
sharpest loss (billable history → gone), followed by `invoices` and
`messages`. The schema's choice to cascade them mirrors the historical
"clean wipe" idiom from the early prototype, before the tax-audit
implication was understood.

### 1f. Delete-vs-deactivate status report

**Status: already correct.** There is no hard-delete reachable from
code today. The DELETE API handler is the soft-delete + Clerk-ban
implementation. The cascade FKs are dormant risks that will only fire
if someone introduces a `.from("clients").delete()` call later.

**One subtle bug** (§1c): the PATCH form path lets Kelsey pick
"Inactive" without triggering the Clerk ban. Recommend either
(a) symmetric ban in PATCH or (b) removing "Inactive" from the
dropdown and routing all deactivations through the DELETE endpoint.
Option (b) is cleaner because it keeps the single source of truth in
one place — the form just gains a "Deactivate" button next to "Save".

---

## 2. `app_settings` — current state

### 2a. Singleton row

Schema (`supabase/schema.sql:223-234`): single-row table with
`singleton boolean not null default true` plus
`constraint app_settings_singleton_unique unique (singleton)`. Cannot
exceed one row by construction.

Seeded twice — once idempotently in `schema.sql:391-393` with empty
`home_address` + defaults, then overridden in
`supabase/seed-financials.sql:84-86` with the real Franklin address.

### 2b. Readers

There is exactly one reader function for `app_settings`:
`fetchAppSettings()` at `app/owner/financials/_lib/queries.ts:22-32`,
wrapped in React's `cache()`:

```ts
export const fetchAppSettings = cache(async (): Promise<AppSettingsRecord> => {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("app_settings row not found");
  return data as AppSettingsRecord;
});
```

Called from three sites (all on `/owner/financials` page renders or
actions invoked by it):
- `app/owner/financials/_lib/queries.ts:134` — inside
  `fetchFinancialsForRange`, consumed for `tax_set_aside_percent`.
- `app/owner/financials/_lib/suggestions.ts:360` — inside
  `fetchSuggestionInputs`, consumed for `home_address`.
- `app/owner/financials/_actions.ts:338` — inside
  `addMileageLogAction`, consumed for `mileage_rate_per_mile`
  (snapshotted into the inserted row).
- `app/owner/financials/_actions.ts:667` — inside
  `acceptMileageSuggestionAction`, same purpose.

No direct `.from("app_settings")` selects exist outside this helper
(grep confirms). All consumers benefit from the request-scoped cache.

### 2c. Writers

**Zero writers in app code.** Greps for any insert/update against
`app_settings` return only:
- `supabase/schema.sql:391-393` (seed insert).
- `supabase/seed-financials.sql:84-86` (seed update).

There is no `.from("app_settings").update(...)` or
`.from("app_settings").upsert(...)` anywhere in app code. The seeded
values are immutable from Kelsey's perspective today.

### 2d. Type definition

`AppSettingsRecord` at `lib/supabase.ts:162-169`:

```ts
export interface AppSettingsRecord {
  id: string;
  singleton: boolean;
  home_address: string;
  mileage_rate_per_mile: number;
  tax_set_aside_percent: number;
  updated_at: string;
}
```

Field constraints (`supabase/schema.sql:223-234`):
- `home_address text not null default ''` — empty string is the
  greenfield default; `''` is treated as "no home address" by
  `computeMileageSuggestions` (`suggestions.ts:270` short-circuits
  returning `[]`).
- `mileage_rate_per_mile numeric not null default 0.70 check (>= 0)`.
- `tax_set_aside_percent numeric not null default 28 check (>= 0 and <= 100)`.
- `updated_at timestamptz not null default now()` — exists but is
  never updated by app code (the seed file at
  `seed-financials.sql:86` does set it explicitly, but no
  app-code write touches it).

Already registered on the `Database` shape at `lib/supabase.ts:263`,
so a new `update()` call site will get typed inference for free.

---

## 3. `recurring_expense_templates` — current state

### 3a. Table + seeded rows

Schema (`supabase/schema.sql:293-308`):

```sql
create table if not exists recurring_expense_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null check (category in (
                  'platform_software', 'marketing_advertising', 'equipment_gear',
                  'travel_transportation', 'professional_services', 'business_operations'
                )),
  amount        numeric not null check (amount > 0),
  day_of_month  smallint not null default 1 check (day_of_month between 1 and 28),
  notes         text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists recurring_expense_templates_active_idx
  on recurring_expense_templates (active);
```

Seeded four rows (`supabase/seed-financials.sql:14-18`):

| name | category | amount | day | notes | active |
|---|---|---|---|---|---|
| Pic-Time | platform_software | 10.00 | 1 | Content delivery / gallery platform | true |
| Canva | platform_software | 15.00 | 1 | Design tool | true |
| iCloud Storage | platform_software | 2.99 | 1 | Storage | true |
| Lightroom | platform_software | 6.99 | 1 | Photo editing | true |

### 3b. Readers

Exactly one reader: `fetchSuggestionInputs` at
`app/owner/financials/_lib/suggestions.ts:366-369`:

```ts
supabase
  .from("recurring_expense_templates")
  .select("*")
  .eq("active", true),
```

Used downstream by `computeExpenseSuggestions`
(`suggestions.ts:197-234`). The active-only filter means deactivating
a template hides its suggestion permanently from then on — no
"recently deactivated" tail-off behavior.

### 3c. Writers

**Zero writers.** Greps confirm no `.from("recurring_expense_templates").insert/update/upsert/delete` anywhere
in app code. Kelsey cannot add, edit, deactivate, or remove templates
without a raw SQL session today.

### 3d. Type definition

`RecurringExpenseTemplateRecord` at `lib/supabase.ts:213-222`:

```ts
export interface RecurringExpenseTemplateRecord {
  id: string;
  name: string;
  category: ExpenseCategory;
  amount: number;
  day_of_month: number;
  notes: string | null;
  active: boolean;
  created_at: string;
}
```

`ExpenseCategory` enum (`lib/supabase.ts:18-24`) matches the schema
CHECK (the six Phase 1 categories). Already registered on `Database`
at `lib/supabase.ts:266-268`.

### 3e. FK behavior — what happens to past expenses on edit/toggle/delete

`expenses.source_template_id` references the template with
`on delete set null` (migration
`supabase/migrations/001_phase4_suggestions.sql:67-69`).

- **Edit (rename, change amount, etc.):** FK unchanged. Past expenses
  keep `source_template_id`. The suggestion compute function uses
  `e.source_template_id === t.id` for the FK suppression bucket
  (`suggestions.ts:201-202`) and falls back to case-insensitive name
  match (`:203-205`) for pre-Phase-4 / orphaned rows. So renaming
  Canva → "Canva Pro" is safe — past expenses stay linked by FK.
- **Toggle active = false:** simple boolean update, no FK action.
  Future suggestions stop appearing (active filter at
  `suggestions.ts:366-369`). Past expenses retain their FK, suppression
  in their original month continues to work.
- **Toggle active = true again later:** suggestions resume for the
  current month forward. Any expense already in the current month
  (logged manually while the template was inactive) gets matched via
  name fallback (`:203-205`); a renamed-while-inactive template will
  re-surface — same rot path documented in `financials-audit-final.md`
  §5 NIT.
- **Hard delete:** all past expenses get their `source_template_id`
  nulled. Suppression for those rows now relies entirely on the
  case-insensitive name match. Brittle if the template was renamed
  before deletion.

**Recommendation: toggle-as-primary, hard delete behind a confirm.**

---

## 4. Existing settings-like surfaces in the portal

### 4a. The `/owner/settings` route already exists

`app/owner/settings/page.tsx`:

```ts
import { Placeholder } from "@/components/ui/Placeholder";

export default function OwnerSettingsPage() {
  return <Placeholder eyebrow="Owner — Settings" title="Settings" />;
}
```

A 5-line placeholder that renders the shared `<Placeholder>` chrome.
No data fetching, no client component, no sub-routes.

### 4b. Sidebar entry

`app/owner/layout.tsx:15`:

```ts
const ownerNav: SidebarNavItem[] = [
  { label: "Dashboard", href: "/owner/dashboard" },
  { label: "Clients", href: "/owner/clients" },
  { label: "Shoots", href: "/owner/shoots" },
  { label: "Calendar", href: "/owner/calendar" },
  { label: "Time Tracker", href: "/owner/time" },
  { label: "Financials", href: "/owner/financials" },
  { label: "Messages", href: "/owner/messages" },
  { label: "Settings", href: "/owner/settings" },   // already wired
];
```

The Settings nav item is already in the sidebar. No layout change
needed.

### 4c. Form-pattern precedent

The cleanest precedent for the `app_settings` form is the
`ClientFormPanel` slide-over at
`app/owner/clients/_components/ClientFormPanel.tsx:139-278`:

- Shared `formStyles.ts` exports: `labelStyle`, `fieldStyle`,
  `errorStyle`, plus `applyFocus`/`clearFocus` helpers
  (`app/owner/clients/_components/formStyles.ts:1-48`).
- `<input>` / `<select>` get the same focus border treatment.
- Submit button uses the shared `Button` component from
  `@/components/ui/Button`.
- Errors render inline via `errorStyle`.

For the template-row inline editing, the precedent is the financials
inline pattern: `<InlineCell>` at
`app/owner/financials/_components/InlineCell.tsx` (used by
`IncomeTable.tsx`, `ExpenseTable.tsx`, `MileageTable.tsx`). Each cell
toggles to an `<input>` on click, commits on blur/Enter, cancels on
Escape, surfaces validation errors inline.

For the table-with-add-row layout, the precedent is the
financials ghost-row pattern (e.g. `IncomeTable.tsx:155-235`): a
trailing ghost row whose `<InlineCell>` placeholders read "Add date…",
"Add client…", etc., and which autosubmits when all required fields
are filled.

---

## 5. Proposed build shape (no code)

### 5a. Route layout

**Single page at `/owner/settings` with three stacked sections.**

```
/owner/settings (server component, dynamic = "force-dynamic")
├── Section 1: Business Settings
│   └── Form: home_address, mileage_rate_per_mile, tax_set_aside_percent
├── Section 2: Recurring Expense Templates
│   └── Table: name, category, amount, day_of_month, active, notes
│       plus ghost row at bottom for add
└── Section 3: (none for now — leave room for future expansion)
```

**Why not tabs or sub-routes:**
- Two sections are tiny. Tabs would feel over-engineered.
- Sub-routes (`/owner/settings/business`, `/owner/settings/templates`)
  fragment one server fetch into two and double the URL surface for
  no UX win.
- A single page lets Kelsey skim both at once.

**Why not nest under `/owner/financials/settings`:**
- The sidebar already routes "Settings" as its own top-level entry.
- `home_address` is also relevant outside financials (any future
  feature that uses geocoding).
- Templates conceptually parallel "client master data" — admin
  surfaces don't live inside the consumer.

### 5b. Data fetching

Three small fetchers in `app/owner/settings/_lib/queries.ts`:

- **`fetchAppSettings()`** — **reuse existing helper** from
  `app/owner/financials/_lib/queries.ts:22-32`. No duplication; the
  `cache()` wrapper amortizes across any same-render co-call. Import
  it directly.
- **`fetchAllTemplates()`** — new. Selects from
  `recurring_expense_templates` ordered by `(active desc, name asc)`,
  or `(name asc)` — pick by UX preference. Returns active *and*
  inactive (the page is the admin surface, not a consumer; it must
  show what's been toggled off).
- **No clients fetch needed.** The page does not depend on
  `fetchClientsWithRelations`.

Page fetches both in `Promise.all`. Hands the data to two client
components: `<AppSettingsForm initial={settings} />` and
`<TemplatesTable initial={templates} />`.

### 5c. Server actions needed

Five new actions in `app/owner/settings/_actions.ts`:

1. **`updateAppSettingsAction(input: UpdateAppSettingsInput)`**
   - Updates the singleton row's `home_address`,
     `mileage_rate_per_mile`, `tax_set_aside_percent`, plus
     `updated_at = now()`.
   - Validates: `home_address` trimmed (empty string allowed —
     mileage suggestions short-circuit gracefully per
     `suggestions.ts:270`); `mileage_rate_per_mile >= 0`;
     `0 <= tax_set_aside_percent <= 100`.
   - Re-uses `isPositiveFiniteNumber` from `lib/validation.ts:6-8` for
     the rate (with a `>= 0` tweak — see §5e) and an inline check for
     the percent range.
   - `revalidatePath("/owner/settings")` plus
     `revalidatePath("/owner/financials")` (so the next financials
     render picks up the new rate / tax percent / home address). The
     `cache()` wrapper is request-scoped, so revalidation is the
     correct invalidation signal.
2. **`createRecurringExpenseTemplateAction(input)`**
   - Validates: non-empty `name`, valid `category`,
     `amount > 0`, `1 <= day_of_month <= 28`, optional `notes`,
     `active` defaults true.
   - Inserts a new row; revalidates `/owner/settings` and
     `/owner/financials`.
3. **`updateRecurringExpenseTemplateAction(id, updates)`**
   - Same validators per field. Partial-update pattern matching
     `updateIncomePaymentAction` (`financials/_actions.ts:110-166`):
     build a `patch: Record<string, unknown>`, only set fields that
     were sent, reject empty patches.
   - Revalidate both paths.
4. **`toggleTemplateActiveAction(id, active)`**
   - Convenience action — a thin one-field update. Could be folded
     into `updateRecurringExpenseTemplateAction`, but a dedicated
     action is friendlier from the table UI (a checkbox row binding
     can call it without building a patch shape).
   - Revalidate both paths.
5. **`deleteRecurringExpenseTemplateAction(id)`**
   - Hard delete. Per §3e, this nulls `expenses.source_template_id`
     for any past expense that referenced this template. The UI must
     gate this behind a confirm-dialog ("This will remove the
     template permanently. Past expenses will be kept but lose their
     template link."). Recommend the **toggle is the primary
     deactivate action**; hard delete is a secondary affordance for
     "I created this by mistake."

All five actions follow the existing Phase 4 conventions:
- `"use server"` directive at top.
- `requireOwner()` guard.
- `getSupabaseServiceClient()`.
- Return `ActionResult<T>` envelope (re-declare locally as Phase 4
  does, or factor — see "shared types" note in §6).
- `revalidatePath` on both `/owner/settings` and `/owner/financials`.

### 5d. UI shape

**Section 1 — App Settings (form-style):**

Three labeled inputs in a vertical stack, save button at the bottom.
A single error region above the button. Optimistic disable while
saving. On success, a subtle "Saved." chip (or just clearing the
form's dirty-state). Use `formStyles.ts` for visual consistency with
`ClientFormPanel`.

`home_address` is a single-line `<input type="text">` (no geocoder
preview today — the address is verbatim-fed to Google Distance Matrix
at trip time). Show a small helper text under it: "Used as the default
origin for mileage suggestions."

`mileage_rate_per_mile` is a `<input type="number" step="0.01" min="0">`
with helper text "Snapshotted onto each mileage log at write time —
changing this does not affect existing rows." (Anchors the user's
mental model.)

`tax_set_aside_percent` is `<input type="number" step="1" min="0" max="100">`
with helper text "Applied to net profit (income minus expenses minus
mileage deduction)."

**Section 2 — Templates (table-style):**

Columns: Name, Category, Amount, Day of Month, Active, Notes, Actions.
- Each cell is an `<InlineCell>` (reuse from
  `app/owner/financials/_components/InlineCell.tsx`); click to edit,
  commit on blur/Enter via `updateRecurringExpenseTemplateAction`.
- "Active" column renders a checkbox bound to
  `toggleTemplateActiveAction`. Inactive rows render dimmed (e.g.
  `opacity: 0.6`).
- "Actions" column renders a small ✕ button → confirm-dialog →
  `deleteRecurringExpenseTemplateAction`.
- Ghost row at bottom for adding — mirrors the financials add-row
  pattern (`IncomeTable.tsx:155-235`). Required: name, category,
  amount, day_of_month. Optional: notes (active defaults true on
  insert).

**Why InlineCell vs. a modal:**
- Kelsey has four templates today. Inline edit is faster.
- The financials surfaces already use this pattern; consistency wins.
- If a 5th column (e.g. `last_logged_at`) ever appears, the inline
  pattern scales; a modal would need a redesign per added column.

### 5e. Validation

Existing helpers (`lib/validation.ts`):
- `isValidDateKey(s)` — not used here (settings has no date fields;
  `day_of_month` is an integer 1-28).
- `isPositiveFiniteNumber(n)` — useful for `amount` but rejects 0.
  `mileage_rate_per_mile` needs `>= 0` not `> 0`; `tax_set_aside_percent`
  needs `>= 0 && <= 100`. Likely keep these inline as one-liners —
  factoring helpers for two single-use predicates is over-rotated.

New validators (if any):
- `isValidDayOfMonth(n): n is number` — `Number.isInteger(n) && n >= 1
  && n <= 28`. Could live in `lib/validation.ts` alongside the
  existing two; nine lines including a docstring. Recommend adding it
  because both the create and update actions use it.

The DB CHECK constraints catch the same conditions at the database
layer, so even a code bug would produce a friendly "value violates
check constraint" error rather than corrupt data — but the TS-level
validation gives Kelsey a readable message at the call site
("Day of month must be between 1 and 28") instead of a raw Postgres
string.

### 5f. Migrations needed

**Zero migrations expected.** Both tables exist with the right shape,
the right constraints, and the right FKs. The Phase 4 build relied on
this being true; the audit confirms it.

The only optional migration to consider is tightening the cascade FKs
on `clients(id)` — see §6 for that discussion. Not needed for this
feature; raised here only because the user asked.

---

## 6. Risks / open questions

1. **Soft-delete on clients — confirm + close the PATCH gap.**
   The hard-delete path is not exposed today (§1a, §1b). The only
   inconsistency is the PATCH-to-inactive does not ban the Clerk
   user (§1c). Two options:
   - (a) Add a symmetric ban branch in the PATCH handler at
     `app/api/clients/[id]/route.ts:160-170`.
   - (b) Remove the "Inactive" option from `ClientFormPanel`'s status
     dropdown and add a dedicated "Deactivate" button on the client
     detail page that calls the DELETE endpoint.
   **Recommend (b)** — single source of truth, no double code path,
   the confirmation friction matches the gravity of the action.
2. **Cascade tightening on `time_logs` / `shoots` / `invoices` /
   `files` / `messages`** — worth a migration?
   - The risk is purely defensive: someone introduces a
     `.from("clients").delete()` later.
   - Flipping `on delete cascade` → `on delete set null` would
     require adding `client_id` nullability where it isn't (e.g.
     `time_logs.client_id`, `shoots.client_id`, `invoices.client_id`,
     `messages.client_id`, `files.client_id` are all currently
     `not null`). That's a non-trivial schema change with downstream
     query implications (every `time_logs.client_id` reader assumes
     non-null today).
   - **Recommend NOT migrating.** Defense-in-depth is appealing but
     the cost-benefit is poor. Instead: add a `// NEVER hard-delete
     clients — use status='inactive'` comment near the schema's
     `clients` table block, and rely on the soft-delete-only UI
     contract. If a future developer ever adds a `.delete()` call,
     they'll see the comment. Cheaper than nullable columns
     everywhere.
3. **`day_of_month` edge cases.** Schema constrains 1–28
   (`schema.sql:301`, "the 28 ceiling is deliberate so Feb is safe").
   The UI form must reject 0, 29, 30, 31, negative, non-integer, and
   non-numeric inputs with a clear message. The DB will reject too
   (CHECK constraint), but the UI message is friendlier. **Confirmed:
   the constraint is correctly in place.** The new
   `isValidDayOfMonth` helper (§5e) handles UI-level rejection.
4. **Active toggle vs delete on templates — past-expense FK
   behavior.** Per §3e: toggle preserves
   `expenses.source_template_id` for past rows; hard delete nulls
   them. The reactivation scenario (deactivate Canva for two months,
   reactivate) **works correctly** — past expenses retain their FK and
   continue to participate in suppression for their original month.
   The only risk path is rename-while-active-toggled-off followed by
   manual logging during the gap, then reactivation — see
   `financials-audit-final.md` §5 NIT for the documented rot path.
   No new defense needed; the build should just default to
   toggle-as-primary.
5. **`mileage_rate_per_mile` mid-year change** — does updating the
   rate affect historical rows?
   **No.** Confirmed at `app/owner/financials/_actions.ts:339`
   (`addMileageLogAction`) and `:668`
   (`acceptMileageSuggestionAction`): both read
   `app_settings.mileage_rate_per_mile` at insert time and snapshot
   the value into the row's `rate_per_mile` column. The financials
   summary computes `deduction = miles * rate_per_mile` per row
   (`queries.ts:232`), reading the snapshotted value. Historical
   rows are immune to mid-year rate changes. The form should
   surface this guarantee in helper text (per §5d) so Kelsey doesn't
   second-guess.
6. **`tax_set_aside_percent` mid-year change** — does this affect
   historical summaries?
   **Yes, retroactively** — `tax_set_aside_percent` is NOT
   snapshotted per row. The summary recomputes `taxSetAside =
   netProfit * (taxRatePercent / 100)` on every render
   (`queries.ts:245`). Changing the rate mid-year will re-base
   prior months when Kelsey navigates back to them. This is
   intentional and correct for the take-home estimate, but worth
   surfacing in helper text: "Applies to all months (past and future)
   on next render." Or accept the surprise — Kelsey is the only user
   and unlikely to scroll back months expecting the tax math to be
   frozen.
7. **`home_address` change mid-year** — does this affect historical
   mileage_logs?
   **No.** Mileage rows store `from_address` per row
   (`schema.sql:273`). The home address in app_settings is only used
   as a *default* for the *next* mileage suggestion's
   `fromAddress` value (`suggestions.ts:305`). Past trips keep
   whatever from_address they were inserted with.
8. **Concurrent updates to app_settings.** The singleton table has
   no row-level locking semantics; concurrent updates from two
   tabs/devices would last-writer-wins. For Kelsey (single-user) this
   is a non-issue. Not worth optimistic-concurrency.
9. **Deactivating a template mid-month.** If Kelsey accepts the Canva
   suggestion on May 3rd, then deactivates Canva on May 15th, the
   May expense row stays (it's a normal `expenses` row). The June
   suggestion will not appear (active filter at
   `suggestions.ts:366-369`). Correct behavior. No edge case to handle.
10. **Renaming a template mid-month.** If Kelsey renames "Canva" to
    "Canva Pro" on May 15th and Kelsey already paid Canva on May 1st
    via the suggestion, the FK suppression still works
    (`source_template_id` match). If she instead manually logged
    "Canva" on May 1st without using the suggestion, the rename
    breaks the name-fallback bucket, and the June suggestion will
    appear with the new name (correct — she expects to see the
    renamed template). Worth a one-line helper text on the rename
    inline-edit: "Past expenses with the old name will keep their
    text label."
11. **`ActionResult<T>` duplication.** Phase 4 declared
    `ActionResult<T>` locally (`financials/_actions.ts:19-23`); the
    new settings actions will be the **seventh** file to do so. The
    Phase 4 audit's "Architectural Notes" (`financials-audit-final.md`
    §1023-1054) recommends status quo "until a 7th `_actions.ts`
    shows up." This is that 7th. Worth a tiny pre-build chore:
    factor to `lib/actions.ts` and update all seven imports
    (3-line file + 7 single-line import changes). Skip if Kelsey
    wants to ship the feature faster — the duplication is shallow.

---

## 7. Ship order

Mirroring the Phase 4 phased build structure
(`financials-phase-4-audit.md` Step 1–6), with relative size
estimates against Phase 4:

| Step | Description | Size vs Phase 4 |
|---|---|---|
| **1** | Migration (if any). **Likely none** — tables already exist. Optional cleanup: shared `ActionResult<T>` factor to `lib/actions.ts`. | **0** (or ~10 lines if factoring) |
| **2** | Types. Add `UpdateAppSettingsInput`, `CreateRecurringExpenseTemplateInput`, `UpdateRecurringExpenseTemplateInput`, plus a `Pick<>` row type for the templates query if needed. Most of the work is reusing `AppSettingsRecord` and `RecurringExpenseTemplateRecord` that already exist. | **~10%** of Phase 4 (Phase 4 added 4 enums + 4 record types + 1 set type) |
| **3** | Helpers. New `fetchAllTemplates()` query in `app/owner/settings/_lib/queries.ts`. Reuse `fetchAppSettings` from financials. Add `isValidDayOfMonth` to `lib/validation.ts`. | **~15%** of Phase 4 (Phase 4 added `getMilesBetween` + `fetchSuggestionInputs` + three compute functions) |
| **4** | Server actions. Five new actions in `app/owner/settings/_actions.ts`: update settings, create / update / toggle / delete template. Each follows the established `requireOwner + validate + Supabase write + revalidatePath` shape; collectively ~250 lines including JSDoc. | **~40%** of Phase 4 (Phase 4 added 4 accept + 1 dismiss + reused 9 add/update/delete actions; counted ~600 LOC of actions) |
| **5** | UI. `<AppSettingsForm>` (form-style, ~150 LOC) + `<TemplatesTable>` (table-style with InlineCell + ghost row, ~300 LOC) + the page composing them. Reuse `<InlineCell>`, `formStyles`, `<Button>`, `<ConfirmDialog>` (already exists per Phase 4 audit grep). | **~60%** of Phase 4 (Phase 4 was a ~1500 LOC client board with three tables and a sugError banner) |
| **6** | Polish: helper text per §5d, error-state styling, accessibility (`aria-label` on InlineCells, `role="alert"` on form errors mirroring `sugError`), keyboard nav verification, confirm dialog wording. | **~30%** of Phase 4 |

**Total estimate:** ~50–60% of Phase 4's size. Lighter because:
- No migration work.
- No background computation (no suggestions to compute, no
  Distance Matrix integration).
- The UI is a form + an admin table — far simpler than a 3-table
  reconciliation board with suggestion overlays.
- Most of the type and validation surface already exists.

Larger because: the build introduces the **first writer surface** for
`app_settings` and `recurring_expense_templates`, so every edge case
must be considered fresh.

---

## Recommendations

Five thumbs-up calls needed before writing the build prompt:

1. **Cascade FKs — leave alone.** The hard-delete path is not
   reachable today (`app/api/clients/[id]/route.ts:175-211` is
   already soft-delete + Clerk-ban). Cost of flipping cascades to
   `set null` (making `client_id` nullable on six tables, plus
   updating every reader) is much higher than the marginal risk
   reduction. Defense-in-depth via a code comment on `schema.sql`'s
   `clients` table block instead. **Confirm: no migration.**
2. **Close the PATCH-to-inactive Clerk-ban gap.** The form lets
   Kelsey pick "Inactive" without banning the Clerk user. Two
   options:
   - **(Recommended)** Remove the "Inactive" option from the
     `ClientFormPanel` status dropdown and add a separate
     "Deactivate Client" button on the detail page that calls
     `DELETE /api/clients/[id]`. Single source of truth.
   - Or: add a symmetric ban branch in the PATCH handler. Less
     surgical, but no UI churn.
   **Confirm: option (a) or option (b).**
3. **Page layout: single `/owner/settings` with two stacked
   sections** (Business Settings form + Templates table). Not tabs,
   not sub-routes. Sidebar entry already exists; placeholder page is
   already in place. **Confirm: single page.**
4. **Templates: toggle-as-primary, hard delete as secondary.** The
   table's "Active" column is a checkbox bound to a
   `toggleTemplateActiveAction`. A small ✕ in the Actions column
   opens a confirm dialog and calls
   `deleteRecurringExpenseTemplateAction`. Kelsey can't accidentally
   destroy historical FKs via a one-click delete. **Confirm: toggle
   primary, delete confirmed.**
5. **Shared `ActionResult<T>` factor — yes or skip.** Settings will
   be the 7th `_actions.ts` to re-declare it. Factoring to
   `lib/actions.ts` is ~10 minutes and removes a pre-existing
   architectural rough edge flagged in the Phase 4 audit. Worth
   doing in Step 1 of this build, but optional — skip if Kelsey
   wants the feature merged faster. **Confirm: factor now, or
   defer to a separate cleanup PR.**

Once these five are confirmed, the build prompt can be written
against this audit without further discovery.
