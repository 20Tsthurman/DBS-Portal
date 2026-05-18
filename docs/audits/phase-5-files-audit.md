# Phase 5 — Files Delivery: Pre-Build Audit

Read-only inventory of the current state of the codebase as it pertains to
building the content-file delivery surface described in blueprint §7.4.
Audit only — no design, no build steps.

---

## 1. Database schema

The `files` table **already exists** in `supabase/schema.sql:187-197`. Full
definition:

```sql
create table if not exists files (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  name          text not null,
  file_url      text not null,
  file_type     text not null check (file_type in ('content', 'contract', 'invoice', 'other')),
  uploaded_at   timestamptz not null default now(),
  uploaded_by   text not null
);

create index if not exists files_client_id_idx on files (client_id);
```

Per-column notes:

- `id` — uuid, PK, default `gen_random_uuid()`.
- `client_id` — uuid, NOT NULL, FK → `clients(id)` `on delete cascade`
  (schema-level cascade; the soft-delete contract documented in
  `schema.sql:10-26` means `clients` rows are never hard-deleted, so the
  cascade is defensive).
- `name` — text, NOT NULL. No length constraint.
- `file_url` — text, NOT NULL. Blueprint puts the public/signed URL here;
  there is no separate `storage_path` column.
- `file_type` — text, NOT NULL, CHECK constraint includes `'other'` in
  addition to the three types named in the blueprint sketch.
- `uploaded_at` — timestamptz, NOT NULL, default `now()`.
- `uploaded_by` — text, NOT NULL. Free-form string (matches the
  `logged_by`/`ownerLabel` pattern used elsewhere — see §4).

Indexes: `files_client_id_idx` on `(client_id)`. No other indexes.

RLS: **none on `files`**, and no RLS anywhere else in the schema either.
`schema.sql:3` explicitly states "RLS policies are added in a later phase."
A grep for `policy|RLS|enable row level` across `supabase/` returns only
that one comment line. The app talks to Supabase exclusively via the
service-role client (see §2), so DB-level RLS is currently moot.

TypeScript mirror exists at `lib/supabase.ts:35` (`FileType` union) and
`lib/supabase.ts:136-144` (`FileRecord` interface) and is wired into
`Database.public.Tables.files` at `lib/supabase.ts:261`.

Conflicts / extensions vs. the blueprint sketch:
- Sketch lists `file_type in (content|contract|invoice)`. Schema also
  permits `'other'`. Either widen the UI vocabulary or restrict writes to
  `'content'` for Phase 5.
- No `mime_type`, `size_bytes`, or `storage_path` columns. Sketch doesn't
  call for them; flagging because signed-URL flows often want a stable
  storage key separate from the public URL.

Migration landing zone (if any schema additions are needed):
- Only one numbered migration exists today:
  `supabase/migrations/001_phase4_suggestions.sql`. So the next would be
  `supabase/migrations/002_<descriptor>.sql`.
- Convention from the existing file: top-of-file comment header explaining
  the migration, idempotent `if not exists` / `add column if not exists`,
  one-shot apply via "Supabase SQL editor" (per the header comment).

---

## 2. Supabase Storage state

- **No storage operations exist in the codebase.** Grep for
  `\.storage\.from\(` across the repo (excluding `node_modules`) returns
  zero matches. Grep for `bucket|getPublicUrl|createSignedUrl|upload\(` in
  application code returns only references in docs/comments — no real
  callers.
- **No bucket definitions.** `supabase/` contains only `schema.sql`,
  `seed.sql`, `seed-financials.sql`, and `migrations/001_phase4_suggestions.sql`.
  Nothing names a Storage bucket.
- **No storage helpers** in `lib/`. `lib/supabase.ts` exposes only the two
  client factories described below.

Env vars referenced in code today (`grep "SUPABASE_"` across the repo):

- `.env.local.example:13-15`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_ROLE_KEY=
  ```
- `lib/supabase.ts:293-294` — anon client reads
  `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `lib/supabase.ts:301-302` — service client reads
  `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

The service-role client is distinct from the anon client and is the one
every server-side caller uses today. Both live in `lib/supabase.ts`:

```ts
// lib/supabase.ts:290-297
let browserClient: SupabaseClient | null = null;
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  browserClient = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
  return browserClient;
}

// lib/supabase.ts:299-310
export function getSupabaseServiceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
```

`getSupabaseBrowserClient()` exists but is not currently called anywhere
for reads/writes — all data access happens server-side via
`getSupabaseServiceClient()`.

---

## 3. Existing upload / file UI surface

- Grep for `type="file"`, `FormData`, `react-dropzone`, `accept=` across
  the repo (excluding `node_modules`) returns **zero matches**. No upload
  UI exists.
- `/owner/clients/[id]` has a Files tab placeholder:
  - Defined in `app/owner/clients/[id]/page.tsx:86-90`:
    ```tsx
    {
      key: "files",
      label: "Files",
      content: <PlaceholderPanel message="File management coming soon." />,
    },
    ```
  - `PlaceholderPanel` is a local component at lines 26-40 in the same
    file — bordered box with muted "coming soon" copy. The tab key `"files"`
    is included in the `TabKey` union at
    `app/owner/clients/[id]/_components/TabNav.tsx:5-11`.
- `/client/files` route exists at `app/client/files/page.tsx` and renders
  only the shared placeholder component:
  ```tsx
  import { Placeholder } from "@/components/ui/Placeholder";

  export default function ClientFilesPage() {
    return (
      <Placeholder eyebrow="Client — Files & Content" title="Files & Content" />
    );
  }
  ```

---

## 4. Patterns to mirror

### `ActionResult<T>` — `lib/actions.ts:1-13` (entire file):

```ts
/**
 * Shared envelope for every server action's return value.
 *
 * Convention: actions never throw to callers — they catch internally and
 * return `{ ok: false, error: "..." }`. Successful writes return
 * `{ ok: true, data }` (when there's a payload) or `{ ok: true }`.
 */
export interface ActionResult<T = null> {
  ok: boolean;
  error?: string;
  data?: T;
}
```

### Owner guard — no `ensureOwner` exists

A repo-wide grep for `ensureOwner` returns hits **only in docs**, never in
TypeScript code. The actual helper is `requireOwner` in `lib/auth.ts:8-20`:

```ts
export async function requireOwner(): Promise<RequireOwnerResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Unauthorized" };
  const user = await currentUser();
  if (user?.publicMetadata?.role !== "owner") {
    return { ok: false, error: "Forbidden" };
  }
  const ownerLabel =
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    "Owner";
  return { ok: true, ownerLabel };
}
```

A sibling `requireOwnerApi()` returns a `NextResponse` for route handlers.

Representative call site — `app/owner/financials/_actions.ts:55-94`:

```ts
export async function addIncomePaymentAction(
  input: AddIncomePaymentInput
): Promise<ActionResult<IncomePaymentRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  // …validation…
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("income_payments").insert({
    // …
    logged_by: guard.ownerLabel,
  }).select("*").single();
  // …
  revalidatePath("/owner/financials");
  return { ok: true, data: data as IncomePaymentRecord };
}
```

The `guard.ownerLabel` value is the convention for filling `uploaded_by`
on the new `files` table (parallel to `logged_by` on `income_payments`,
`time_logs`, and `mileage_logs`).

### Client-side helpers — `lib/currentClient.ts`

Both helpers live in one file. Doc comment at top of file is the source of
truth for behavior; quoting the signatures and a representative use:

```ts
// lib/currentClient.ts:18-32
export async function getCurrentClient(): Promise<ClientRecord | null> {
  const user = await currentUser();
  if (!user) return null;
  if (user.publicMetadata?.role !== "client") return null;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients").select("*").eq("clerk_user_id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ClientRecord | null) ?? null;
}

// lib/currentClient.ts:39-43
export async function requireCurrentClient(): Promise<ClientRecord> {
  const client = await getCurrentClient();
  if (!client) throw new Error("Not signed in as a client");
  return client;
}
```

Representative call sites:
- `getCurrentClient` — `app/client/messages/page.tsx`, `app/client/book/page.tsx`,
  `app/client/book/_lib/queries.ts`, `app/api/messages/inbox/route.ts`,
  `app/api/messages/unread-counts/route.ts`, `app/api/messages/read/route.ts`,
  `app/api/messages/route.ts` (server components and route handlers — places
  where "not signed in" is a renderable state).
- `requireCurrentClient` — `app/client/book/_actions.ts:8` (server actions
  where "not signed in" is unrecoverable). Usage pattern:
  ```ts
  // app/client/book/_actions.ts:8
  import { requireCurrentClient } from "@/lib/currentClient";
  // …inside the action…
  const client = await requireCurrentClient();
  // …use client.id…
  ```

### Financials page as the styling reference

File layout under `app/owner/financials/`:

```
page.tsx                          ← server component; reads searchParams,
                                    fetches data, renders <FinancialsToolbar>
                                    + <FinancialsBoard>; force-dynamic.
_actions.ts                       ← all server actions (add / update /
                                    delete / accept-suggestion / dismiss).
_lib/queries.ts                   ← typed fetchers, row-shape types
                                    (IncomeRow, ExpenseRow, MileageRow),
                                    label constants, summary aggregator.
                                    Uses React `cache()` for app-settings
                                    read.
_lib/suggestions.ts               ← derived suggestion compute (Phase 4).
_lib/types.ts                     ← CommitResult and other shared types.
_components/FinancialsBoard.tsx   ← top-level client component, owns
                                    inline-edit state, calls actions.
_components/FinancialsToolbar.tsx ← URL-driven month / YTD switcher.
_components/IncomeTable.tsx       ← per-section table.
_components/ExpenseTable.tsx
_components/MileageTable.tsx
_components/InlineCell.tsx        ← shared cell-edit primitive.
_components/StatCardIcons.tsx     ← local SVG icon set.
_components/BreakdownPanel.tsx
_components/InsightsPanel.tsx
```

`_actions.ts` / `_lib/queries.ts` split:
- All `"use server"` mutations live in `_actions.ts`. Each action calls
  `requireOwner()`, validates inputs, calls `getSupabaseServiceClient()`,
  and ends with `revalidatePath("/owner/financials")`.
- All read-side fetchers live in `_lib/queries.ts`. They throw on Supabase
  errors (server components bubble to React error boundary).
- Suggestion compute is split into `_lib/suggestions.ts` (pure functions
  over fetched inputs).

CSS variables used (sample from `page.tsx:147-152` and the board / panels):
- `var(--font-playfair)` — page title font family.
- `var(--text-primary)`, `var(--text-body)`, `var(--text-muted)` — copy
  hierarchy.
- `var(--surface-raised)` — card / panel backgrounds (used by the placeholder
  pattern in `app/owner/clients/[id]/page.tsx:26-40`).
- `var(--border)` — hairline dividers, tab underline.
- `var(--accent)` — active-tab underline, primary buttons.

UI components imported by the financials surface:
- `DashboardCard` (`components/ui/DashboardCard.tsx`) — eyebrow + title +
  body container; used for `INCOME` / `EXPENSES` / `MILEAGE` /
  `BREAKDOWN` / `INSIGHTS` sections (`FinancialsBoard.tsx:824, 840, 856`,
  `BreakdownPanel.tsx:74, 100`, `InsightsPanel.tsx:85`).
- `StatCard` (`components/ui/StatCard.tsx`) — five summary tiles
  (`FinancialsBoard.tsx:793-815`).
- No `Button` or `StatusPill` imports inside financials (it uses inline
  `pillButton` / `iconButton` styles in `FinancialsToolbar.tsx:167, 181`).
  `StatusPill` is used elsewhere (e.g. `app/owner/clients/[id]/page.tsx:3`)
  and would be the right pick for a file-type badge on the table.

---

## 5. Library inventory

From `package.json` (lines 14-32):

```json
"dependencies": {
  "@clerk/nextjs": "^6.0.0",
  "@supabase/supabase-js": "^2.45.0",
  "next": "^15.0.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "resend": "^4.0.0",
  "svix": "^1.93.0"
},
"devDependencies": {
  "@types/node": "^22.0.0",
  "@types/react": "^19.0.0",
  "@types/react-dom": "^19.0.0",
  "autoprefixer": "^10.4.20",
  "postcss": "^8.4.49",
  "svix-cli": "^1.93.0",
  "tailwindcss": "^3.4.17",
  "typescript": "^5.6.3"
}
```

Relevant to file handling:
- `@supabase/supabase-js@^2.45.0` — ships `.storage` API (`upload`,
  `createSignedUrl`, `getPublicUrl`, etc.). No additional Supabase package
  needed.
- `next@^15.0.0` — server actions and route handlers natively accept
  `FormData` / `File`; no separate body-parser needed.

**Not present** (so any of these is a net-new dep):
- No `react-dropzone` or other drag-drop UI library.
- No MIME-sniffing / `file-type` package.
- No image-processing library (`sharp`, `jimp`, `image-size`, etc.).
- No `nanoid` / `uuid` (UUIDs come from the DB default).

---

## 6. Architectural debt that touches this work

### `requireOwner` duplication — none

There is **no `ensureOwner` helper in code** (matches in
`docs/portal-status.md`, `docs/features/messages.md`,
`docs/features/scheduling.md`, `docs/dashboard-time-tracker-audit.md` are
all prose). The actual helper, `requireOwner`, is defined once in
`lib/auth.ts:8` and imported from there in 8 application files:

```
app/owner/clients/_actions.ts
app/owner/settings/_actions.ts
app/api/clients/[id]/route.ts
app/owner/calendar/_actions.ts
app/owner/time/_actions.ts
app/owner/shoots/_actions.ts
app/owner/financials/_actions.ts
app/owner/financials/page.tsx
```

(`app/owner/time/_components/ExportMonthlyCsvButton.tsx` also imports it,
inside a route-handler-style flow.) Centralized — no duplication to clean
up before Phase 5.

### `fetchClientNames` helper — not shared

There IS a `fetchClientNames` function but it is a **private helper inside
`app/owner/calendar/_lib/queries.ts:259`**, used only by that module
(line 94, line 205). It is not exported and not a candidate for re-use by
the owner client dropdown today.

The owner-side client dropdowns still pull through
`fetchClientsWithRelations` (defined `app/owner/clients/_lib/queries.ts:22`),
which does the heavy 4-table join. Current callers:

```
app/owner/clients/page.tsx:21
app/owner/dashboard/_components/ClientRosterWidget.tsx:2,16
app/owner/dashboard/_components/BudgetStatusWidget.tsx:3,43
app/owner/shoots/page.tsx:8,24
app/owner/financials/_lib/suggestions.ts:15,359
```

The known overhead is called out at `docs/features/scheduling.md:317`,
`docs/financials-phase-4-audit.md:533`, and
`docs/financials-audit-final.md:649`. If a file-upload modal needs only
`{id, name}` for a client picker on `/owner/clients/[id]` (no picker needed
since the page is already client-scoped), there is no new caller to worry
about. If a global "upload to client X" entry point gets built, it would
become the 6th caller of `fetchClientsWithRelations` — same shape as the
existing debt, not new.

---

## Summary of gaps

Things that don't exist yet and will need a build decision before Phase 5
can ship:

- **Supabase Storage bucket.** No bucket is defined anywhere in the repo;
  one must be created (in the Supabase dashboard or via migration) and its
  name codified somewhere the app can reference.
- **Storage RLS / access policy.** No storage policies exist. Need a
  decision: rely on the service-role client and signed URLs (matches the
  current DB pattern, no RLS), or set up bucket policies for direct
  client access.
- **Storage path strategy.** The `files` table stores only `file_url`.
  Decide whether to add a `storage_path` column for the canonical key, or
  derive the storage key from the URL on delete.
- **`file_type` vocabulary for Phase 5.** Schema allows
  `content|contract|invoice|other`; blueprint §7.4 is content-only. Decide
  whether the upload UI exposes a type picker, hard-codes `'content'`, or
  ships `'other'` as a catch-all.
- **MIME / size validation.** No MIME detection or `size_bytes` column
  exists. Decide whether to enforce client/server-side limits and whether
  to persist `mime_type` and `size_bytes` (would require a schema add in
  `supabase/migrations/002_…sql`).
- **Upload UI primitive.** No file-input, drag-drop, or upload progress
  component exists. Pick: hand-roll a basic `<input type="file">` or pull
  in `react-dropzone` (new dep).
- **Server action surface.** No `app/owner/files/_actions.ts` or
  `app/owner/clients/[id]/_actions.ts` exists. New file(s) needed,
  following the financials pattern (`requireOwner`, validate, service
  client, `revalidatePath`).
- **Owner UI placement.** `app/owner/clients/[id]/page.tsx:86-90` Files
  tab still renders `PlaceholderPanel`. Replace with a Files tab component
  that lists `files` rows and surfaces the upload action.
- **Client-side download UI.** `app/client/files/page.tsx` renders only
  `<Placeholder/>`. Needs a real fetcher (scoped via `getCurrentClient`)
  and download links.
- **Signed-URL helper.** No helper in `lib/` for issuing a signed URL on
  read. Decide whether downloads use a pre-stored public URL on `file_url`
  or are minted on demand (signed URLs).
- **Delete flow.** No action exists for removing a file; will need to
  delete both the storage object and the `files` row, decide on
  soft-delete vs. hard-delete (current `files` row has no `deleted_at`).
- **Optional: `fetchClientNames` shared helper.** Pre-existing debt, not a
  blocker for Phase 5 since the upload entry point lives on a
  client-scoped page. Flagged here only because if a global uploader is
  added later it would become the 6th caller of
  `fetchClientsWithRelations`.
