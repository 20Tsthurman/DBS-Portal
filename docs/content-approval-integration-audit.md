# Content & Approval Feature — Codebase Integration Audit

*Read-only audit, 2026-08-26. Companion to `DBS_Content_Approval_Feature.md` (spec v1.0, currently at the repo root, untracked). All file/line references are against `main` @ `bf98d5b`.*

The spec's decisions are treated as settled. This document answers twelve questions about how the feature lands in the existing code, then proposes a phase split. It recommends nothing beyond that.

---

## Part 1 — Reuse

### 1. Owner calendar month grid — coupling and extraction cost

**The grid is already presentational.** `app/owner/calendar/_components/MonthView.tsx` takes `{ monthKey, events: CalendarEvent[], now? }` (lines 11–17) and does no data fetching. The spec's instruction to "extract the existing month grid into a presentational component that accepts an events array" is roughly 70% done by accident. The remaining coupling is four specific points:

1. **The `CalendarEvent` type** — `app/owner/calendar/_lib/types.ts:40–70`. Its `source` field is a discriminated union of exactly `shoot | time_block | external`, and `category`/`status` (lines 25–38) are shoot-and-time-block vocabularies. A content item doesn't fit any variant. The file's own header (lines 17–20) says views must consume only this type, and that isolation was designed so a new source only touches the mapper — but the union itself must still grow a variant (or the grid must accept a narrower, generic event shape).
2. **`MonthEventPill`** — `app/owner/calendar/_components/MonthEventPill.tsx`. Hard-codes the owner-calendar edit URL (`editHref = /owner/calendar?...&edit=${event.id}`, line 15), Google-external link-out behavior (lines 71–84), and pulls colors from `visualsForEvent` in `_lib/eventColors.ts`, which is keyed on the shoot/time-block category vocabulary.
3. **Day-cell navigation** — `MonthView.tsx:79` builds `dayHref = /owner/calendar?view=month&month=${monthKey}&date=${dk}`, used by both the empty-cell click target (line 99) and the "+N more" overflow link (line 154). Both point into the owner calendar's DayPanel route.
4. **Location/layering** — the component lives under `app/owner/calendar/_components/`. The codebase's stated convention (see `lib/date.ts:1–10` header) is that shared code moves to neutral `lib/`/`components/` rather than client surfaces importing from `app/owner/**`. If the client-side review queue ever renders this grid, it must move.

**What extraction takes:** move `MonthView` to `components/` (or keep it owner-side if only Kelsey's content calendar uses it — the client review queue in the spec is a *queue*, not a calendar, so this may suffice); parameterize the two href builders and the pill renderer (a `renderEvent(event)` render prop, or an `eventHref`/`pillVisuals` mapping, is the smallest change); and either widen `CalendarEvent.source` with a `{ kind: "content_item"; itemId; clientId; status }` variant or define a minimal `GridEvent` interface the calendar types satisfy. The grid math is already fully extracted and pure: `monthGridDateKeys` / `dateKeyInMonth` (`app/owner/calendar/_lib/timezone.ts:305–315, 324–326`) and `dateKeyInTimezone` (`lib/date.ts:29–40`) — string math only, no server-local Date reads. New events plug in as a fourth mapper alongside `shootToEvent` / `timeBlockToEvent` / `externalEventToEvent` in `app/owner/calendar/_lib/queries.ts:128–195` (assembled in `fetchEventsInRange`, lines 59–126). The spec's §3.9 timezone trap is institutionalized here: `combineDateAndTimeInTimezone` (`timezone.ts:388–412`) is the sanctioned way to build instants from wall-clock parts.

### 2. Supabase Storage uploads — the current path, end to end

Three-step flow, all in the files feature:

1. **Mint** — `createFileUploadUrlAction` (`app/owner/clients/[id]/_actions.ts:69–97`): `requireOwner()` guard → filename validation → `loadActiveClient` existence/active check (lines 34–54) → `buildStoragePath` (`lib/storage.ts:39–42`, key format `{clientId}/{uuid}-{sanitizedFilename}`) → `createSignedUploadUrl` (`lib/storage.ts:52–65`) via the service-role client against the private `client-files` bucket (`lib/storage.ts:9`; bucket created in `supabase/migrations/001_initial_schema.sql:583–585`, `public=false`, no storage RLS — signed URLs only). *Observed discrepancy: `UPLOAD_URL_TTL_SECONDS = 60` (`lib/storage.ts:12`) is declared and documented but never passed to the `createSignedUploadUrl` call, which takes only the path.*
2. **Client-side upload** — the browser PUTs the file body directly to the signed URL via XHR so progress events are available: `uploadFileWithProgress` (`app/owner/clients/[id]/_components/FilesPanel.tsx:44–72`), driven from `handleUpload` (lines 193–255). Nothing is persisted before this; an abandoned PUT leaks nothing.
3. **Finalize (row insert)** — `finalizeFileUploadAction` (`_actions.ts:114–175`): re-guards, rejects a tampered path prefix (`storagePath.startsWith(`${clientId}/`)`, line 134), then **verifies the object actually landed** via `readUploadedObjectMetadata` (`lib/storage.ts:147–176` — lists the parent folder filtered to the exact name and reads back real mime/size), and only then inserts the `files` row with the verified metadata.

Downloads mint 1-hour signed URLs with a Content-Disposition filename (`createSignedDownloadUrl`, `lib/storage.ts:74–90`). Deletes are DB-row-first, storage-object best-effort-second (`deleteFileAction`, `_actions.ts:232–268`) — an orphaned object is accepted as cheap. Server-generated PDFs bypass the signed-URL dance via `uploadServerBuffer` (`lib/storage.ts:106–120`).

**Relevance:** this is structurally the exact shape Stream Direct Creator Upload requires (spec §3.6): server mints one-time URL → browser uploads direct → server verifies and persists. The finalize-verification step is the seam where polling `readyToStream` slots in, and the path-tamper check is the pattern for validating the Stream UID belongs to the claimed item.

### 3. Client ownership verification

**There are no browser-side Supabase queries at all.** `getSupabaseBrowserClient` (`lib/supabase.ts:448–455`) exists but has zero call sites (verified by grep). Every query runs server-side through `getSupabaseServiceClient` (`lib/supabase.ts:457–468`), which bypasses RLS. Ownership is therefore enforced entirely in the application layer, through one consolidated helper plus a per-query convention:

- **The helper:** `getCurrentClient` / `requireCurrentClient` (`lib/currentClient.ts:18–43`) — resolves the Clerk session to its `clients` row (`role === "client"` in publicMetadata, then `clerk_user_id` lookup). Owner-role gates live in `lib/auth.ts` (`requireOwner` :10, `requireOwnerApi` :24, and `requireOwnerOrClientApi` :56 for the dual-role message API routes, which resolves the client row for client callers).
- **Pattern A — ownership baked into the query.** Representative call site: `fetchMyInvoiceById` (`app/client/invoices/_lib/queries.ts:92–108`) — `.eq("id", invoiceId).eq("client_id", clientId).neq("status","draft").is("inactive_at", null).maybeSingle()`. Deliberately returns `null` identically for missing / not-yours / draft / inactive so nothing leaks "exists but not yours" (documented at lines 84–91).
- **Pattern B — fetch then compare.** Representative call site: `createFileDownloadUrlAction` (`app/client/files/_actions.ts:22–60`) — `requireCurrentClient()`, fetch the `files` row by id, then `if (file.client_id !== client.id) return { ok:false, error:"Forbidden" }` (lines 47–49) before minting the signed URL.

New content tables should follow the same two patterns; the spec's §3.5(a) "verify the requesting client owns that content item before minting a playback token" is Pattern B verbatim.

### 4. SlidePanel, ConfirmDialog, StatusFilterPills, InvoiceRow/InvoiceCard

| Component | Verdict | Detail |
|---|---|---|
| `SlidePanel` (`app/owner/clients/_components/SlidePanel.tsx`) | **Generic — reuse as-is** | Props are `open/onClose/title/widthPx/children`; owns focus trap, Escape, scroll lock, `inert`. Already consumed by 8 features across both surfaces, including client-side `app/client/book/_components/RequestShootFormPanel.tsx`. One constraint, documented at lines 56–58: the body scroll-lock is not re-entrant — never open two at once. Its home under `app/owner/clients/` is historical accident; fine to keep importing from there. |
| `ConfirmDialog` (`components/ui/ConfirmDialog.tsx`) | **Generic — reuse as-is** | `variant: default/danger/success`, `busy` state, nullable `cancelLabel` for single-button info dialogs. Fits the spec's deny-confirmation and the round-2+ price-consent dialog (§5.8) without changes. |
| `StatusFilterPills` (`app/owner/invoices/_components/StatusFilterPills.tsx`) | **Invoice-specific — copy the pattern, not the component** | Hard-coded `ITEMS` list and `/owner/invoices?status=` hrefs (lines 16–34). It's ~75 lines of Link-based query-param filtering; a content-status variant is a 10-minute copy-adapt, not a parameterization exercise. |
| `InvoiceRow` / `InvoiceCard` (`app/owner/invoices/_components/`) | **Invoice-specific; the split *pattern* and its primitives are the reusable part** | Both import invoice actions directly and branch on `effective_status`. What generalizes: `InvoicesTable.tsx:49–97` renders `<table>` inside `hidden lg:block` plus `MobileCardList` inside `lg:hidden`, and the mobile side is built from the genuinely generic primitives in `components/ui/MobileCard.tsx` (`MobileCard/Header/Field/Actions/List`). `StatusPill` (`components/ui/StatusPill.tsx`) is also generic and used everywhere. New content list surfaces should repeat this Row+Card-over-MobileCard convention. |

### 5. Existing polling pattern

Yes — messages. **Mechanism:** `useVisibilityPolling` (`lib/hooks/useVisibilityPolling.ts`): fetch on mount, then `setInterval`; tears the interval down when `document.visibilityState === "hidden"` and fires an immediate fetch + re-arms on return; one `AbortController` per in-flight request; optional `invalidationEvent` re-fetch fan-out over a `window` event. **Interval:** `DEFAULT_POLL_INTERVAL_MS = 30_000` (line 9) — all four consumers use it:

- `components/messages/MessageThread.tsx:218` → polls `GET /api/messages?clientId=` (fetch at lines 127–130)
- `components/ui/SidebarWithUnread.tsx:66–69`, `app/owner/messages/_components/MessagesInbox.tsx:82–85`, `app/owner/dashboard/_components/UnreadMessagesWidget.tsx:50–53` — all three also subscribe to the `messages:invalidate-counts` window event.

No websockets, no SSE, no Supabase Realtime anywhere. The spec's §4.7 "requests appear for Kelsey in real time" maps onto this: a 30s visibility-aware poll of an API route (routes guarded per `lib/auth.ts` patterns, e.g. `app/api/messages/inbox/route.ts`).

---

## Part 2 — Integration points

### 6. Invoice line items — origin, and where an unbilled charge surfaces

**Origin:** line items are typed by hand into `InvoiceFormPanel` (`app/owner/invoices/_components/InvoiceFormPanel.tsx`) — `LineItemDraft[]` state (lines 45–59), row editor (377–451), max 20 items, client-side validation (173–222). The server re-validates in `validateLineItems` (`app/owner/invoices/_actions.ts:61–96`) and stores them as a JSONB array of `{description, amount}` on `invoices.line_items` (`supabase/migrations/001_initial_schema.sql:219`; typed at `lib/supabase.ts:145`), with `invoices.amount` = the sum. **There is no existing injection/suggestion mechanism inside the invoice form** — nothing currently pre-populates line items from elsewhere. The nearest analogue in the codebase is the financials suggestions system (`app/owner/financials/_lib/suggestions.ts` — server-computed suggestion arrays passed to the board as props, accept/dismiss actions routed by `referenceId`), which is the house pattern for "pending thing → one-click accept into a record."

**Where the one-click addition lands** *(the following plumbing is inferred, not existing code — marked as a guess)*: the panel already receives per-open props through `InvoicesBoard` (`_components/InvoicesBoard.tsx:81–88`) from the server page. Unbilled charges for the selected client (`revision_rounds` where `is_billable and invoice_id is null and status='addressed'` — condition shape per spec §6) would either be passed down the same prop path keyed by client, or fetched by a server action when `values.clientId` changes (precedent for client components calling data-returning actions exists, e.g. `createInvoicePdfDownloadUrlAction`). Clicking one appends a `LineItemDraft` and records the round id in form state; `createInvoiceAction` / `updateInvoiceAction` (`_actions.ts:141–216, 230–355`) accept an optional `revisionRoundIds` and stamp `revision_rounds.invoice_id` after the invoice write — the spec's step 4 (§6.2).

### 7. Income posting on payment — the trace, and what a revision charge must look like

**Stripe path:** `app/api/webhooks/stripe/route.ts`. Signature verification on the raw body (lines 53–64) → `checkout.session.completed` → `handleCheckoutSessionCompleted` (92–311): invoice looked up by `session.metadata.invoice_id` (105–111); idempotency via an early `status === "paid"` return (129–134) plus a race-safe `update ... .neq("status","paid").select()` flip (174–194); then the `income_payments` insert (196–209) with `amount = session.amount_total / 100`, `income_type` copied from the invoice, `source: "invoice"`, `invoice_id` set. Confirmation email + receipt PDF are best-effort afterward (221–305).

**Manual path:** `markInvoicePaidAction` (`app/owner/invoices/_actions.ts:499–629`) — inserts `income_payments` with `amount` = the **sum of `line_items`** (526–546), then flips the invoice.

**What a revision charge needs to flow through unchanged: nothing.** Both paths derive the income amount from the invoice total (Stripe's session total, or the line-item sum) and never inspect individual line items beyond summing. A revision round added as one more `{description, amount}` entry raises the total and rides through the webhook, the income insert, the receipt PDF (which iterates `line_items` generically, webhook lines 243–266), and the cash-basis recognition timing — with zero modification. The only new write anywhere is stamping `revision_rounds.invoice_id` at invoice-build time (question 6); the payment pipeline is untouched. This is exactly the property the spec's §6.2/§6.3 accrual design was counting on.

### 8. Resend — templates, triggers, portal links

- **Templates:** hand-built inline-styled HTML strings, no react-email. One shared shell — `buildShell` (`lib/messageEmails.ts:9–93`): dark-green branded header, cream body, Playfair/DM Sans, toggleable eyebrow/greeting/CTA-button, footer; all interpolations pass through `lib/escapeHtml.ts`. Feature modules compose it: `lib/invoiceEmails.ts` (`buildInvoiceSentEmailHtml` :11, `buildInvoicePaymentConfirmationEmailHtml` :52, `buildInvoiceOverdueEmailHtml` :90 — note the sent/confirmation builders branch on `hasPortalAccess`), `buildNewMessageEmailHtml` / `buildUnreadReminderEmailHtml` (`messageEmails.ts:95–117`).
- **Trigger points:** four kinds — server actions (`sendInvoiceAction` sends inline at `_actions.ts:440–464`; `markInvoicePaidAction` at 582–606), webhooks (Stripe route 268–292), cron routes (`app/api/cron/unread-reminders/route.ts:193–213`), and the shared notification helper `maybeSendNewMessageEmail` (`lib/messageNotifications.ts:27–121`), which implements a 24-hour cooldown via timestamp columns on `clients`. Every site constructs `new Resend(process.env.RESEND_API_KEY)` inline with `from = process.env.RESEND_FROM_EMAIL || "Digital Bloom Socials <onboarding@resend.dev>"` — there is no shared send wrapper.
- **Portal link construction:** `resolveBaseUrl()` (`lib/baseUrl.ts`) — requires `NEXT_PUBLIC_APP_URL` in production (explicitly refuses Host/VERCEL_URL derivation) — with the path appended: `${base}/client/invoices`, `${base}/client/messages`, `${base}/owner/messages?clientId=...`.

The spec's release email (§5.1) is a new builder module + a send inside the release server action + `${resolveBaseUrl()}/client/<nav-label-TBD>` — pure pattern repetition.

### 9. Scheduled jobs — what exists, what a new one requires

**Vercel cron is already configured.** `vercel.json` defines two daily jobs: `/api/cron/unread-reminders` at `0 23 * * *` and `/api/cron/google-sync` at `0 11 * * *`. The route pattern (`app/api/cron/unread-reminders/route.ts:11, 23–31`; same contract documented in `google-sync/route.ts:7, 14–15`): `export const dynamic = "force-dynamic"`, a GET handler that rejects unless `Authorization === Bearer ${process.env.CRON_SECRET}`, work in a helper returning a JSON summary, 500 with message on throw.

**Adding the deadline-lock job (spec §3.9) requires exactly three things:** a new `app/api/cron/content-deadlines/route.ts` copying that guard; one more entry in `vercel.json`; a deploy. `CRON_SECRET` already exists in the environment and Vercel injects the header automatically. Cron schedules are UTC, but since `revision_deadline` is a `timestamptz` compared against `now()`, the sweep is correct regardless of the run hour — the only tuning decision is how soon after a Central-time deadline the lock lands (a daily 11:00 UTC run means up to ~24h of grace; running it early-morning Central narrows that). *Note: Vercel Hobby-plan cron only guarantees daily granularity — fine for this spec, but rules out an hourly sweep without a plan change (unverified against the account's current plan).*

---

## Part 3 — Conventions

### 10. Migration numbering

Live migrations run `001_initial_schema.sql` through `014_invoice_inactive.sql` (plus `_archive/`, which the archive README says must never be run). **Next available number: `015`.**

**Is 014 applied?** Not directly verifiable from the repo — there is no Supabase CLI link/config; migrations are applied by hand in the SQL Editor (014's own header, lines 19–20: "Run manually in the Supabase SQL Editor against prod before the Vercel deploy that ships the UI"; same run-order convention in `001_initial_schema.sql:30–34`). The indirect evidence that it **is** applied: 014 landed in `bf98d5b` (2026-08-25), which is HEAD of both `main` and `origin/main`, and that same commit ships code that reads `invoices.inactive_at` on essentially every invoice surface — client list/detail queries (`app/client/invoices/_lib/queries.ts:77, 103`), the owner panel, and the Stripe webhook's select (`app/api/webhooks/stripe/route.ts:108`). If production (portal.digitalbloomsocials.com) is running this deploy — and the commit sequence says the UI shipped after the migration — an unapplied 014 would 500 every invoice page. Treat as applied, pending a ten-second `select inactive_at from invoices limit 1` sanity check in the SQL Editor.

### 11. RLS policy pattern

**There are no RLS policies anywhere** — zero `CREATE POLICY` statements in the repo (verified by grep). The pattern to match is *policy-free fail-closed RLS*, stated and executed at the end of the initial schema. Verbatim, `supabase/migrations/001_initial_schema.sql:598–627`:

```sql
-- ============================================================================
-- ROW-LEVEL SECURITY
--
-- RLS is enabled — with NO policies — on the 11 tables below: the 9 client-facing
-- tables plus the 2 owner-only tasks/timer tables (todos, active_timer).
-- With no policy present, RLS is fail-closed: any role WITHOUT the BYPASSRLS
-- attribute sees zero rows. The app accesses these tables exclusively through
-- the Supabase service-role key, which HAS BYPASSRLS, so this is behaviorally
-- inert today — it is a defense-in-depth margin against a stray anon /
-- authenticated connection, and it matches the live database exactly.
--
-- The other 6 tables (time_blocks, app_settings, income_payments,
-- mileage_logs, recurring_expense_templates, dismissed_suggestions) are
-- intentionally left WITHOUT RLS, also matching live.
--
-- `enable row level security` is idempotent, so a re-run is a safe no-op and
-- no guard is needed.
-- ============================================================================
alter table clients   enable row level security;
alter table packages  enable row level security;
alter table projects  enable row level security;
alter table shoots    enable row level security;
alter table time_logs enable row level security;
alter table invoices  enable row level security;
alter table expenses  enable row level security;
alter table messages  enable row level security;
alter table files     enable row level security;
alter table todos        enable row level security;
alter table active_timer enable row level security;
```

The five new content tables are client-facing, so migration 015 should end with the same `alter table ... enable row level security;` block (no policies), with authorization enforced in app code per question 3. Related schema conventions from the same file worth matching: text + CHECK constraints instead of Postgres enums (header lines 27–28), no triggers/functions (25–26), `DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT` idempotency for every check.

### 12. TypeScript row types — where they live, how they stay in sync

**Hand-maintained, single file, no codegen.** `lib/supabase.ts` holds one exported interface per table (`ClientRecord` … `ExternalEventRecord`, lines 59–384) plus the string-literal union types the CHECK constraints mirror (lines 3–57). They assemble into a deliberately loose `Database` type via `TableShape` (lines 386–436): `Row = TRow & Record<string, unknown>`, `Insert`/`Update` = `Partial<TRow>`. There is no `supabase gen types` anywhere (`package.json` scripts are dev/build/lint/typecheck only) — sync is by convention: every migration that touches a column also edits the interface, and the interfaces carry provenance doc-comments ("Added in migration 005", "since migration 004", the migration-013 note on `CashTaxClass`, etc.). Query results are cast (`data as XRecord`), so drift is caught by discipline, not the compiler.

Feature-level *derived* shapes live in each feature's `_lib`: `InvoiceWithClient` (`app/owner/invoices/_lib/queries.ts`), `CalendarEvent` (`app/owner/calendar/_lib/types.ts`), financials types (`app/owner/financials/_lib/types.ts`). New work therefore adds: five `*Record` interfaces + union types (`ContentCycleStatus`, `ContentItemStatus`, `Platform`, `PostFormat`, `AssetProvider`, `RevisionCategory`) + five `Database.Tables` entries in `lib/supabase.ts`, and view-model types under the new feature's `_lib/`.

---

## Part 4 — Proposed phase split

Six phases. Each is deployable to production without breaking anything (owner-side phases are invisible to clients until Release exists, which is the natural safety gate). "Guess" marks anything not grounded in existing code.

### Phase 1 — Schema, types, and owner item CRUD (photos only)
**Ships:** Migration `015` (five tables per spec §3.8, text+CHECK enums, fail-closed RLS block, indexes on `client_id`/`cycle_id`/`scheduled_for`); the five `*Record` interfaces + unions in `lib/supabase.ts`; an owner content surface (plain list/table grouped by date is enough for this phase — the calendar view is Phase 2) with create/edit/delete of cycles and items; **photo** assets via the existing signed-URL upload flow (mint → XHR PUT → verify-and-finalize, cloned from the files feature). Everything stays `status='drafting'`; no client visibility.
**Depends on:** nothing.
**Riskiest unknown:** where photos live in Storage — same `client-files` bucket under a new path convention vs. a new `content-assets` bucket. The spec says only "Supabase Storage (unchanged)"; `lib/storage.ts` hard-codes `FILES_BUCKET` throughout, so a second bucket means parameterizing that module. *(Guess: a new bucket keeps review photos out of the client Files feature, which lists rows from `files` — since content assets get their own table, either works; this is the decision to make first.)*

### Phase 2 — Calendar extraction + content calendar view
**Ships:** `MonthView` grid parameterized per question 1 (pill renderer + href builders injected; `CalendarEvent` grows a `content_item` source variant or the grid accepts a generic event shape); the owner calendar untouched in behavior; Kelsey's content calendar view feeding the grid from `content_items` with the spec's all-clients/single-client filter toggle.
**Depends on:** Phase 1 (items to render).
**Riskiest unknown:** regressing the live owner calendar while parameterizing — MonthView/MonthEventPill are small, but `eventColors.ts` visuals and the DayPanel deep-links are load-bearing. Mitigation is that the extraction is mechanical and the existing calendar has no tests *(no test infrastructure exists in the repo at all — worth knowing before touching shared code)*.

### Phase 3 — Cloudflare Stream integration, owner-side only
**Ships:** Cloudflare account + env keys (spec §9 defers account creation to now); a `lib/stream.ts` mirroring `lib/storage.ts`'s shape — mint Direct Creator Upload URL (`maxDurationSeconds` ≈ 120, `requireSignedURLs: true`), poll `readyToStream`, mint short-lived signed playback tokens, delete video; TUS browser upload with background-continue behavior (spec §3.7) and a retryable failure surface; `content_assets` processing→ready state; owner-side playback of ready assets.
**Depends on:** Phase 1 (asset rows). Independent of Phase 2.
**Riskiest unknown:** the whole phase is new-vendor risk — signed playback token minting (key management for URL signing) and TUS resume-across-refresh (persisting the upload URL client-side) have no precedent in this codebase. This is the phase to prototype first if anything is prototyped. *(Guess: the signing-key storage location — env var vs. DB — is undecided; env var matches how every other secret is handled here.)*

### Phase 4 — Release + client review queue, round 1
**Ships:** Release action (blocked until every asset `ready` — spec §4.2), `in_review` state, unrelease/re-release; the Resend release email (new builder over `buildShell`, link via `resolveBaseUrl()`); the client review queue — resumable by construction since progress is just per-item status; per-item Approve; the guided request-changes form (categories + per-category comment + timestamp notes) writing `revision_rounds`/`revision_notes`; per-item submit-and-lock (§5.4); Kelsey's rollup counts (§4.5) and 30s-poll arrival of submissions (`useVisibilityPolling` + a guarded API route, per question 5).
**Depends on:** Phases 1 + 3 (photos-only would technically work after 1 alone, but releasing without video playback is not a real release).
**Riskiest unknown:** this is the largest phase and the only one with meaningful client-facing UX (the "older, less technical clients" constraint, §5). If it needs splitting in practice, the seam is Release+queue+Approve first, request-changes form second — both halves still ship behind the release gate.

### Phase 5 — Kelsey's revision handling + re-release
**Ships:** accept/deny per submitted item (deny requires reason + `ConfirmDialog`, client sees reason); replacement upload with side-by-side old/new playback before committing; on accept, explicit Stream delete of the superseded video (spec §3.5c) and `content_assets.replaced_at` versioning; working-state lockout for the client (§4.8); re-release opening the next round.
**Depends on:** Phases 3 + 4.
**Riskiest unknown:** orphaned-Stream-video leaks on partially-failed replace flows — the codebase's existing "DB row first, storage delete best-effort, log the failure" contract (question 2) is the precedent, but Stream orphans cost storage minutes forever and are invisible; the delete-on-replace ordering needs deliberate design, not just pattern-copying.

### Phase 6 — Deadline cron, locks, and billing accrual
**Ships:** (a) `/api/cron/content-deadlines` + `vercel.json` entry (question 9): past-deadline `in_review` cycles → untouched items auto-approve with `approved_by='auto'`, cycle → `locked`; Kelsey's manual Lock-now button. (b) Billing: round-2+ price shown in a pre-submission consent confirmation (§5.8, wording still TBD per spec §9); accrued unbilled charges visible to Kelsey; the one-click line-item addition in `InvoiceFormPanel` + `invoice_id` stamping (question 6); the fully-denied-round-not-billed rule (§6.1).
**Depends on:** Phase 4 (rounds exist); Phase 5 for the deny-path billing exemption.
**Riskiest unknown:** the InvoiceFormPanel plumbing for loading a client's unbilled charges (prop-drill vs. on-select server action — *guess, both are unprecedented in that panel*), and the auto-approve sweep's idempotency if the cron runs while Kelsey is mid-edit. The cron mechanics themselves are the safest new code in the project (pure pattern copy).

*(a) and (b) are separable into two smaller sessions if needed; they're grouped because both are small and both close out "enforcement.")*

---

*Audit complete. No code was modified. The spec file referenced as `docs/DBS_Content_Approval_Feature.md` in the audit request actually lives at the repo root (`DBS_Content_Approval_Feature.md`, untracked).*
