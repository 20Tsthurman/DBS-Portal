# Phase 4 — Invoices: Pre-Build Audit

Read-only inventory of the current state of the codebase as it pertains to
building the Invoices feature (blueprint §6.5 / §7.5). Audit only — no
design, no build steps.

---

## 1. Schema state — `invoices` table

The `invoices` table **already exists** in `supabase/schema.sql:138-151`.
Full definition:

```sql
create table if not exists invoices (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients(id) on delete cascade,
  amount                numeric not null,
  due_date              date,
  paid_at               timestamptz,
  status                text not null check (status in ('draft', 'sent', 'paid', 'overdue')) default 'draft',
  stripe_payment_link   text,
  line_items            jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists invoices_client_id_idx on invoices (client_id);
create index if not exists invoices_status_idx on invoices (status);
```

Per-column notes vs. blueprint sketch `(id, client_id, amount, due_date,
paid_at, status, stripe_payment_link, line_items)`:

- Every blueprint field is present, same names and same semantics.
- `client_id` cascades on delete — defensive only (schema.sql:10-26 codifies
  the never-hard-delete contract for clients).
- `amount` is `numeric` (no precision/scale specified; same convention as
  `income_payments.amount`, `expenses.amount`).
- `due_date` is **nullable**. Blueprint sketch does not say.
- `paid_at` is **nullable** (set when status flips to `paid`).
- `status` CHECK is exactly the blueprint vocabulary: `draft | sent | paid
  | overdue`. Default `draft`.
- `stripe_payment_link` is **nullable** plain `text`. No format constraint.
- `line_items` is `jsonb not null default '[]'`. Shape not enforced at the
  DB layer.
- `created_at` is present; `updated_at` is **not**.
- No `invoice_number` / human-readable identifier column.
- No `description` / `memo` column.
- No `sent_at` timestamp (so the only sent-vs-draft signal is `status`).
- No `currency` column (USD implied).

Indexes:

- `invoices_client_id_idx on (client_id)`
- `invoices_status_idx on (status)`

No alignment-block ALTERs target `invoices`. No alignment-block backfill
or constraint adjustment exists for this table. Nothing in the schema's
alignment section (`schema.sql:327+`) touches invoices — the CREATE TABLE
block is authoritative.

TypeScript mirror — `lib/supabase.ts:99-109`:

```ts
export interface InvoiceRecord {
  id: string;
  client_id: string;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
  status: InvoiceStatus;
  stripe_payment_link: string | null;
  line_items: Array<{ description: string; amount: number }>;
  created_at: string;
}
```

`InvoiceStatus` enum — `lib/supabase.ts:17`:

```ts
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";
```

`Database.public.Tables.invoices` is wired up in the generated shape —
`lib/supabase.ts:263`:

```ts
invoices: TableShape<InvoiceRecord & Record<string, unknown>>;
```

The `line_items` shape (`{ description, amount }[]`) is a TS-side
convention; nothing in `schema.sql` enforces it. Row count: no app code
path reads or writes `invoices` (see §2 last bullet) and no seed file
inserts into it — the table is empty in every environment.

---

## 2. Income / payment infrastructure invoices must integrate with

`income_payments` table — `supabase/schema.sql:258-279`:

```sql
create table if not exists income_payments (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid references clients(id) on delete set null,
  client_name_snapshot  text not null,
  payment_date          date not null,
  amount                numeric not null check (amount > 0),
  income_type           text not null check (income_type in (
                          'brand_retainer', 'wedding_same_day',
                          'one_off_shoot', 'other'
                        )),
  payment_method        text,
  notes                 text,
  logged_by             text not null,
  created_at            timestamptz not null default now()
);

create index if not exists income_payments_payment_date_idx
  on income_payments (payment_date);
create index if not exists income_payments_client_id_idx
  on income_payments (client_id);
create index if not exists income_payments_income_type_idx
  on income_payments (income_type);
```

A `source` column was added later by `supabase/migrations/001_phase4_suggestions.sql`
with values `'manual' | 'suggested_retainer'` (NULL = pre-migration manual
inserts).

TypeScript mirror — `lib/supabase.ts:176-194`:

```ts
export interface IncomePaymentRecord {
  id: string;
  client_id: string | null;
  client_name_snapshot: string;
  /** YYYY-MM-DD */
  payment_date: string;
  amount: number;
  income_type: IncomeType;
  payment_method: string | null;
  notes: string | null;
  logged_by: string;
  created_at: string;
  /**
   * NULL = manually entered (existing rows + manual ghost-row inserts);
   * 'suggested_retainer' = created from accepting a Phase 4 brand-retainer
   * income suggestion.
   */
  source: IncomePaymentSource | null;
}
```

Existing read/write call sites for `income_payments` (eight files reference
it; the production call sites are):

- **Insert (manual)** — `app/owner/financials/_actions.ts:74-87`
  (`addIncomePaymentAction`):
  ```ts
  const { data, error } = await supabase
    .from("income_payments")
    .insert({
      client_id: null,
      client_name_snapshot: trimmedName,
      payment_date: input.payment_date,
      amount: input.amount,
      income_type: input.income_type,
      payment_method: input.payment_method?.trim() || null,
      notes: input.notes?.trim() || null,
      logged_by: guard.ownerLabel,
    })
  ```
- **Insert (suggestion accept)** — `app/owner/financials/_actions.ts:507-521`
  (`acceptIncomeSuggestionAction`) — same shape, plus `client_id` and
  `source: "suggested_retainer"`.
- **Update** — `app/owner/financials/_actions.ts:148-154`
  (`updateIncomePaymentAction`).
- **Delete** — `app/owner/financials/_actions.ts:170-174`
  (`deleteIncomePaymentAction`).
- **Read (financials page)** — `app/owner/financials/_lib/queries.ts:126-134`
  via `fetchFinancialsForRange()` — selects the seven display columns
  filtered by `payment_date` range.
- **Read (suppression check)** — `app/owner/financials/_lib/suggestions.ts:374-378`
  — selects `client_id, payment_date, income_type` to dedupe suggestions.
- **Read (stale-state re-check inside accept action)** —
  `app/owner/financials/_actions.ts:494-501` — same suppression logic
  re-run server-side under the action.

Cross-table linkage — **no `invoice_id` FK exists on `income_payments`**
and no `source` enum value names invoices. The current values are:

```ts
export type IncomePaymentSource = "manual" | "suggested_retainer";
```

There is no schema-level way today for an income row to point back at
the invoice that produced it. Flagged.

Existing code that touches the `invoices` table: **none**. Grepping
`from("invoices")` returns zero matches across `app/`. The only places
the string `invoice` appears are:

- `app/client/layout.tsx:12` — `{ label: "Invoices", href: "/client/invoices" }`
  sidebar item.
- `app/client/invoices/page.tsx` — placeholder page (see §8).
- `app/owner/clients/[id]/page.tsx:99-103` — tab definition with content
  `<PlaceholderPanel message="Invoices coming in Phase 4." />`.
- `app/owner/clients/[id]/_components/TabNav.tsx:10` — `"invoices"`
  string in the `TabKey` union.
- `app/owner/clients/[id]/_components/DeactivateClientButton.tsx` — text
  copy only ("invoices, etc.").
- `lib/supabase.ts` — type + table-shape registration only.
- `supabase/schema.sql` — table definition only.

No production read or write path touches the table.

---

## 3. Stripe integration state

`package.json:14-22` dependencies — neither `stripe` nor `@stripe/stripe-js`
is installed:

```json
"dependencies": {
  "@clerk/nextjs": "^6.0.0",
  "@supabase/supabase-js": "^2.45.0",
  "next": "^15.0.0",
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "resend": "^4.0.0",
  "svix": "^1.93.0"
}
```

`devDependencies` likewise have nothing Stripe-related.

Codebase grep for `stripe` (case-insensitive) outside `node_modules`:

- `supabase/schema.sql:145` — `stripe_payment_link text,` (the invoices
  column, already-defined).
- `lib/supabase.ts:106` — `stripe_payment_link: string | null;` (TS mirror).
- `docs/dbs-portal-blueprint-v1.md` — 10 mentions, all blueprint copy.
- `app/owner/calendar/_lib/eventColors.ts` and four calendar/booking
  components — every match is the unrelated CSS-stripe pattern
  (`stripeBackgroundImage`, `diagonal-stripes`, `SHOOT_STRIPE_COLOR`).

So: **zero Stripe SDK usage, zero Stripe payment-flow code**. The only
hint of Stripe in the runtime code is the `stripe_payment_link` column
sitting empty.

Env-var grep for `STRIPE_`: no hits anywhere in the repo. `STRIPE_` does
not appear in `.env.local.example`, source, or docs.

`.env.local.example` (entire file) — no Stripe block:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/finalizing

# Base URL of the deployed app. Used in invite emails, message
# notifications, and other Resend templates that need an absolute link.
# Set to https://<your-vercel-domain> in production.
NEXT_PUBLIC_APP_URL=http://localhost:3000

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=

# The From address used by all Resend send calls. Must match a verified
# domain in the Resend dashboard.
RESEND_FROM_EMAIL=Digital Bloom Socials <noreply@digitalbloomsocials.com>

# Kelsey's inbox. Receives new-message notifications and the daily
# unread-reminder cron output. Plain email address, no display name.
OWNER_NOTIFICATION_EMAIL=

# Signing secret for the Clerk webhook endpoint.
# Get this from Clerk dashboard → Webhooks → your endpoint → Signing secret.
# It must start with `whsec_`.
CLERK_WEBHOOK_SECRET=whsec_...

# Used by /api/cron/unread-reminders to authenticate the daily cron job.
# Generate any opaque random string; must match the value configured in
# Vercel's cron settings.
CRON_SECRET=

# Google Maps Distance Matrix API key. Server-side only — never prefix with
# NEXT_PUBLIC_. Used by lib/google-maps.ts to compute mileage on accept of
# a Phase 4 mileage suggestion. The Distance Matrix API must be enabled on
# the key's GCP project.
GOOGLE_MAPS_API_KEY=
```

Route surface — `app/api/` children: `clients`, `cron`, `invite`,
`messages`, `webhooks`. The only thing under `webhooks/` is `clerk/`. No
`app/api/stripe/`, no `app/api/webhooks/stripe/`. No Stripe-related
route anywhere.

---

## 4. Webhook infrastructure — Clerk precedent

Handler: `app/api/webhooks/clerk/route.ts` (236 lines).

Top of file — imports + the secret/signature gate at the top of POST
(`app/api/webhooks/clerk/route.ts:1-7, 141-176`):

```ts
import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { clerkClient } from "@clerk/nextjs/server";
import {
  linkClerkUserToClient,
  unlinkClerkUserFromClient,
} from "@/lib/clerk";
```

```ts
export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[clerk webhook] CLERK_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret is not configured" },
      { status: 500 }
    );
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing svix signature headers" },
      { status: 400 }
    );
  }

  const payload = await request.text();

  let event: ClerkWebhookEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    const message = err instanceof Error ? err.message : "verification failed";
    console.warn("[clerk webhook] signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
```

Notes for mirroring with Stripe:

- Signature verification uses **svix** (`new Webhook(secret).verify(...)`).
  Stripe uses its own `stripe.webhooks.constructEvent(...)` API and
  different headers (`stripe-signature`) — svix won't be reusable for
  Stripe verification.
- Secret is read via `process.env.CLERK_WEBHOOK_SECRET` with an explicit
  missing-secret 500 guard at the top of POST.
- Payload is read with `request.text()` (raw body) before being passed
  to the verifier — Stripe also needs the raw body.
- Switch statement on `event.type`, each branch returns
  `NextResponse.json({ received: true, action: "..." })` so Svix sees
  2xx + a small machine-readable action tag in the response. Errors
  inside a branch return non-2xx so Svix retries (`status: 500` on
  transient failure path).
- Logging tag is `[clerk webhook]` consistently across log lines —
  precedent for `[stripe webhook]` style tagging.

`dev:webhook` script — `package.json:7`:

```json
"dev:webhook": "npx svix-cli listen http://localhost:3000/api/webhooks/clerk"
```

Hardcoded to the Clerk path. `svix-cli` is a devDependency
(`package.json:29`). Stripe local tunneling uses `stripe listen --forward-to`
instead, which is not installed and not in any script.

There is also `test:webhook` → `node --env-file=.env.local scripts/test-webhook.mjs`.
The only script under `scripts/` is `test-webhook.mjs`; nothing else.

---

## 5. PDF generation capability

`package.json` deps and devDeps: **nothing PDF-related** —
no `pdfkit`, `puppeteer`, `react-pdf`, `@react-pdf/renderer`, `jspdf`,
`pdf-lib`, `playwright`, `chromium`, `weasyprint`, or any HTML→PDF
service SDK.

Code grep for `pdf` (case-insensitive), `.pdf`, `application/pdf`,
`jspdf`, `puppeteer`, `pdfkit`, `react-pdf`, `pdf-lib`:

- `docs/dbs-portal-blueprint-v1.md:222, 225, 287, 316` — blueprint
  references only ("Send via Resend (email with PDF attachment + Stripe
  payment link)", "PDF download", "Download PDF button on each row",
  "Invoice creation + PDF generation").
- Zero hits in `app/`, `lib/`, `components/`, or `supabase/`.

No existing HTML-to-PDF code, no print-CSS work, no PDF MIME type
appears in `lib/storage.ts` (`createSignedDownloadUrl` accepts any MIME
via the `download` filename hint, so the bucket itself is format-agnostic).

---

## 6. Email infrastructure — Resend

Resend client is **not** instantiated in a shared module — it is
constructed inline at each call site.

Call site 1 — message notifications (`lib/messageNotifications.ts:71-90`):

```ts
const resendKey = process.env.RESEND_API_KEY;
if (!resendKey) {
  return { sent: false, error: "RESEND_API_KEY not configured" };
}

const resend = new Resend(resendKey);
const fromAddress =
  process.env.RESEND_FROM_EMAIL ||
  "Digital Bloom Socials <onboarding@resend.dev>";

const { error: sendError } = await resend.emails.send({
  from: fromAddress,
  to: recipientEmail,
  subject: `New message from ${senderName} — Digital Bloom Socials`,
  html: buildNewMessageEmailHtml({
    recipientName,
    senderName,
    portalUrl,
  }),
});
```

Other call sites with the same `new Resend(resendKey)` + `resend.emails.send`
shape:

- `app/api/invite/route.ts:556-572` — invitation email (HTML template
  built inline in the same file via `buildInviteEmailHtml`).
- `app/api/cron/unread-reminders/route.ts` — daily reminder cron
  (uses `buildUnreadReminderEmailHtml` from `lib/messageEmails.ts`).

Template pattern: **raw HTML template strings**, not React Email
components. Templates live in `lib/messageEmails.ts` for the messaging
family (`buildNewMessageEmailHtml`, `buildUnreadReminderEmailHtml`) and
inline in the invite route. They use a `buildShell(...)` helper that
takes `{headline, bodyParagraph, portalUrl, recipientName, titleTag}` and
returns a complete `<!doctype html>` document with an inline-styled
table-based layout (`lib/messageEmails.ts:9-69`). User-supplied strings
are run through `escapeHtml` from `lib/escapeHtml.ts` before
interpolation.

FROM address: `process.env.RESEND_FROM_EMAIL`, default
`Digital Bloom Socials <onboarding@resend.dev>` (transactional sandbox
domain) when unset. `.env.local.example:20` documents the prod default
as `Digital Bloom Socials <noreply@digitalbloomsocials.com>` and notes
"Must match a verified domain in the Resend dashboard." Domain
verification status is not introspectable from the repo — it's a
dashboard setting.

Rate limiting / retry / queue:

- No queue, no retry-with-backoff.
- The 24-hour-per-recipient cooldown in
  `lib/messageNotifications.ts:25-63` is the only throttle, and it
  applies only to the new-message email family (not invites).
- Cron runs once daily and selects only clients past their own cooldown,
  so it's implicitly throttled.
- No global send-rate gate around Resend itself.

---

## 7. Owner-side financials surface

Directory listing of `app/owner/financials/`:

```
_actions.ts
_components/
  BreakdownPanel.tsx
  ExpenseTable.tsx
  FinancialsBoard.tsx
  FinancialsToolbar.tsx
  IncomeTable.tsx
  InlineCell.tsx
  InsightsPanel.tsx
  MileageTable.tsx
  StatCardIcons.tsx
_lib/
  queries.ts
  suggestions.ts
  types.ts
page.tsx
```

`page.tsx` is a single-surface server component. It resolves the
`{month | ytd}` range from search params, fetches rows + suggestions in
parallel, then renders one header (`<h1>Financials</h1>`), one toolbar
(`<FinancialsToolbar />`), and one `<FinancialsBoard />` (a client
component). No tab system at the page level — `FinancialsBoard` lays
out a stat-card row plus three side-by-side cards (Income, Expenses,
Mileage) and a Breakdown + Insights pair beneath them
(`app/owner/financials/_components/FinancialsBoard.tsx:792-885`):

```tsx
<div className="financials-summary-grid">
  <StatCard label="Total Income" ... />
  <StatCard label="Total Expenses" ... />
  <StatCard label="Net Profit" ... />
  <StatCard label={`Tax Set-Aside (${...}%)`} ... />
  <StatCard label="Est. Take-Home" ... />
</div>

<div className="financials-main-grid">
  <DashboardCard eyebrow="INCOME" title="Payments received">
    <IncomeTable ... />
  </DashboardCard>
  <DashboardCard eyebrow="EXPENSES" title="Expenses logged">
    <ExpenseTable ... />
  </DashboardCard>
  <DashboardCard eyebrow="MILEAGE" title="Trips logged">
    <MileageTable ... />
  </DashboardCard>

  <div className="financials-insights-pair">
    <BreakdownPanel summary={summary} />
    <InsightsPanel ... />
  </div>
</div>
```

There is no tab navigation; adding a fourth dashboard-card section
would be the natural slot, or the page would need a new tab/route
container introduced.

Toolbar: `FinancialsToolbar` is a Month/YTD switcher with prev/next
month arrows and a "Today" button. URL contract is
`?range=month&month=YYYY-MM` or `?range=ytd` — the toolbar emits
plain `<Link>`s to the page itself, no client-side state
(`app/owner/financials/_components/FinancialsToolbar.tsx:22-105`). The
month is dimmed in YTD view.

Dedicated `app/owner/invoices/` route: **does not exist**.

The only owner-side mention of invoices is the per-client tab placeholder
(`app/owner/clients/[id]/page.tsx:99-103`):

```tsx
{
  key: "invoices",
  label: "Invoices",
  content: <PlaceholderPanel message="Invoices coming in Phase 4." />,
}
```

---

## 8. Client-side invoices surface

`app/client/invoices/page.tsx` (entire file):

```tsx
import { Placeholder } from "@/components/ui/Placeholder";

export default function ClientInvoicesPage() {
  return <Placeholder eyebrow="Client — Invoices" title="Invoices" />;
}
```

Client sidebar nav — `app/client/layout.tsx:7-13`:

```tsx
const clientNav: SidebarNavItem[] = [
  { label: "My Project", href: "/client/dashboard" },
  { label: "Messages", href: "/client/messages" },
  { label: "Book a Shoot", href: "/client/book" },
  { label: "Files & Content", href: "/client/files" },
  { label: "Invoices", href: "/client/invoices" },
];
```

The nav entry is already wired. The page renders nothing but the shared
`Placeholder` shell.

---

## 9. File storage for invoice PDFs

`lib/storage.ts` exists and exports:

```ts
export const FILES_BUCKET = "client-files";

export function buildStoragePath(clientId: string, filename: string): string;

export async function createSignedUploadUrl(
  storagePath: string
): Promise<{ signedUrl: string; token: string }>;

export async function createSignedDownloadUrl(
  storagePath: string,
  filename: string
): Promise<string>;

export async function deleteStorageObject(storagePath: string): Promise<void>;

export async function readUploadedObjectMetadata(
  storagePath: string
): Promise<{ mimeType: string; sizeBytes: number }>;
```

Bucket policy (per the module-level docstring,
`lib/storage.ts:3-9`): service-role only, no RLS, no public access; reads
and writes go through signed URLs minted server-side. Signed upload URLs
live 60s, signed download URLs live 1h. Storage keys are
`{clientId}/{uuid}-{sanitized-filename}` (`buildStoragePath` at
`lib/storage.ts:39-42`).

`files.file_type` CHECK constraint (`supabase/schema.sql:192`) already
includes `'invoice'`:

```sql
file_type text not null check (file_type in ('content', 'contract', 'invoice', 'other')),
```

Note the post-Phase-5 column rename: `file_url` is now `storage_path`
(see `supabase/migrations/002_files_storage.sql`), and the TS mirror
exposes `storage_path`, `mime_type`, `size_bytes`
(`lib/supabase.ts:136-149`).

`FilesList` in the client surface already filters
`file_type === "content"` for the "Deliverables" bucket and groups
everything else (including `invoice` rows) under "References"
(`app/client/files/_components/FilesList.tsx:27-28`):

```tsx
const deliverables = files.filter((f) => f.file_type === "content");
const references = files.filter((f) => f.file_type !== "content");
```

No invoice rows have been written; the bucket can hold them without
schema or RLS changes.

---

## 10. Patterns to mirror

- **`ActionResult<T>`** — `lib/actions.ts:8-12`:
  ```ts
  export interface ActionResult<T = null> {
    ok: boolean;
    error?: string;
    data?: T;
  }
  ```
- **`requireOwner()`** — `lib/auth.ts:8-20`, returns
  `{ ok: true, ownerLabel } | { ok: false, error }`. Every owner-side
  server action opens with `const guard = await requireOwner(); if
  (!guard.ok) return { ok: false, error: guard.error };`
  (see `app/owner/financials/_actions.ts:58-59`).
- **`requireCurrentClient()`** — `lib/currentClient.ts:39-43`, throws on
  the no-client path; matched by `getCurrentClient()` which returns
  null. Used by client-side server actions where missing client is
  unrecoverable.
- **Financials action structure** — validate inputs (`isValidDateKey`,
  `isPositiveFiniteNumber`, enum-membership checks against the
  module-level allow-lists) → `const supabase = getSupabaseServiceClient();`
  → mutation → `revalidatePath("/owner/financials");` → return
  `{ ok: true, data }`. Service-role client always; no RLS reliance.
- **`_lib/queries.ts` + `_actions.ts` + `_components/` co-location** —
  the convention used by `app/owner/financials/`, `app/owner/messages/`,
  `app/owner/clients/`, `app/owner/clients/[id]/`, `app/client/files/`,
  etc. Queries throw on Supabase error; actions catch internally and
  return the `ActionResult` envelope (per the docstring in
  `lib/currentClient.ts:11-17` and the in-file behavior across `_actions.ts`
  files).
- **`revalidatePath` target** — actions hit the page that owns them
  (`revalidatePath("/owner/financials")`); deeper routes use their own
  path string. No `revalidateTag` usage in the financials family.

---

## 11. Open architectural questions surfaced by this audit

- How does an invoice payment correlate with an `income_payments` row?
  FK on the income side (new `invoice_id` column + new `source` enum
  value `'invoice'`)? Webhook-side insert with no link? Trigger?
- Should there be a 1:N invoice→payments relationship to support partial
  payments, or strictly 1:1 paid-in-full?
- Which library generates the PDF? (None installed. Candidates span
  `@react-pdf/renderer`, `pdfkit`, `puppeteer`, `pdf-lib`, plus
  hosted services.)
- Where does the PDF live — generated on-demand from invoice data, or
  rendered once and stored in `client-files` as a `file_type='invoice'`
  row?
- Where does the owner's invoice **creation** UI live — new section /
  fourth card inside `/owner/financials`, new top-level
  `/owner/invoices` route, only inside the per-client
  `/owner/clients/[id]` "Invoices" tab, or all three?
- How do invoices flip to `overdue` — Vercel cron sweep on a schedule,
  on-read derivation (status='sent' && due_date < today), or both?
- Is the Stripe webhook the only path to `paid`, or is there a manual
  "mark as paid" affordance for cash / Zelle / check?
- Does the client's "Pay Now" use a Stripe Payment Link (column name
  hint) or Stripe Checkout Sessions (more control, per-invoice line
  items, webhook metadata)? Two different integration shapes.
- How is the invoice→Stripe object linked back at webhook time?
  Metadata `invoice_id` on the Checkout Session? Client_reference_id?
  Lookup by amount+email?
- What signature-verification library is used for Stripe — the official
  `stripe` package's `webhooks.constructEvent`, requiring `STRIPE_*`
  env vars and adding a non-trivial dep?
- How is local webhook dev handled — add a second script
  (`dev:stripe-webhook` running `stripe listen --forward-to`) alongside
  `dev:webhook`, or unify them?
- Are draft invoices editable, sent invoices editable, paid invoices
  immutable? What's the boundary?
- Does each invoice need a human-readable number (`INV-2026-0001`)? If
  yes, where is the sequence generated — DB sequence, app-side counter,
  random short code?
- Currency: USD-only assumption acceptable, or add a column / default
  now?
- Tax handling — is sales-tax / line-item tax in scope for v1? (Per the
  blueprint hint: probably no, but it needs to be called out.)
- Does the invoice email reuse `buildShell()` from
  `lib/messageEmails.ts` (with a new `buildInvoiceEmailHtml`), or get
  its own template file? Where does the PDF attach? Resend supports
  base64 attachments via `attachments: [...]` — confirm the API shape.
- `RESEND_FROM_EMAIL` domain verification status for the prod address
  needs to be confirmed in the Resend dashboard before invoices go out.
- Where does the per-client tab placeholder
  (`app/owner/clients/[id]/page.tsx:99-103`) point — does it become a
  filtered view of the global invoices surface, or its own inline UI?

---

## Summary of gaps

Things to be built or decided before the build:

- **Stripe SDK install** — `stripe` (server) and `@stripe/stripe-js`
  (browser, only if the client UI needs Stripe.js directly).
- **Stripe env vars** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (if browser Stripe.js used);
  add to `.env.local.example`.
- **`app/api/webhooks/stripe/route.ts`** — new route, mirroring the
  Clerk pattern's structure but with Stripe's signature verification
  and raw-body handling.
- **`dev:stripe-webhook`** (or equivalent) script using
  `stripe listen --forward-to` — current `dev:webhook` only proxies to
  Clerk.
- **Webhook event handler map** — at minimum `checkout.session.completed`
  / `invoice.paid` / `payment_intent.succeeded` (which one depends on
  the chosen flow).
- **PDF generation library** — none exists; pick one.
- **Invoice→income linkage** — schema change: either an `invoice_id` FK
  on `income_payments` (plus a new `source` value `'invoice'`) or a
  different correlation strategy.
- **Owner-side invoice UI surface** — does not exist; decide where.
- **Client-side invoices page** — currently a `Placeholder`; needs a
  list, payment CTA, and per-invoice PDF download.
- **Per-client "Invoices" tab** in `app/owner/clients/[id]/page.tsx` —
  currently a "coming in Phase 4" placeholder.
- **Invoice email template** — does not exist; decide whether to extend
  `lib/messageEmails.ts:buildShell` or add a new file.
- **PDF attachment on Resend send** — pattern not yet used in the
  codebase.
- **Overdue-status transition mechanism** — cron? derived? both?
- **Manual mark-as-paid affordance** for non-Stripe payments — exists
  in the income flow today but not in any invoice flow.
- **Invoice number scheme** — no column, no generator.
- **Partial-payment policy** — schema currently has one `amount` and
  one `paid_at`; either declare paid-in-full-only or extend schema.
- **Edit-after-send policy** — no enforcement exists.
- **`stripe_payment_link` semantics** — is it a Stripe-hosted Payment
  Link URL, a Checkout Session URL, or empty (replaced by a per-load
  Checkout Session creation)?
- **Resend prod-domain verification** — confirm
  `noreply@digitalbloomsocials.com` is verified.
- **Tax handling** — explicit yes/no for v1.
