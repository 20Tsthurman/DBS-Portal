# Content & Approval — Build Plan
**Digital Bloom Socials Portal**
*Version 1.0 — August 2026*

Companion to:
- `DBS_Content_Approval_Feature.md` — what the feature is and how it behaves (settled)
- `docs/content-approval-integration-audit.md` — how it lands in the codebase (findings)

This document is the sequencing layer: what gets built, in what order, split into sessions.

---

## How to use this document

**One phase per Claude Code session.** Fresh context each time. At the start of every session, Claude Code re-reads the spec, the audit, and this plan — it should not be carrying state from a previous session.

**Phases with more than one slice can be split further** if a session is running long. Slice boundaries are chosen to be independently stoppable — you can end a session at a slice boundary and resume cleanly next time.

**Verification stays with Tanner.** Claude Code writes files and runs typecheck/lint/build. Tanner runs migrations in the Supabase SQL Editor and triggers deploys. Claude Code does not deploy.

**Every phase ends with a STOP.** No phase rolls into the next.

---

## Sequencing rationale

The audit proposed six phases. This plan uses nine, with three changes:

| Change | Reason |
|---|---|
| Cloudflare Stream moved from 3rd to 2nd | The audit names it the highest-risk phase with no precedent in the codebase, then schedules two phases of surface area ahead of it. De-risk before building on the assumption it works. |
| Audit Phase 4 split in two | The audit itself flags it as the largest phase and names the seam. Take the seam. |
| Audit Phase 6 split in two | Pairs a pure pattern copy (cron) with the only money-touching, unprecedented plumbing in the feature (invoice injection). Those don't belong in one session. |

Calendar work sits at Phase 3 so Kelsey's building surface is finished before Phase 4, which is the first time she builds a real month.

---

## Phase map

| # | Phase | Slices | Risk | Client-visible | Status |
|---|---|---|---|---|---|
| 0 | Prep and decisions | 3 | None | No | **Complete** |
| 1 | Schema, types, owner CRUD (photos) | 4 | Low | No | 1.1–1.2 done |
| 2 | Cloudflare Stream, owner-side | 4 | **High** | No |
| 3 | Calendar extraction + content calendar | 3 | Medium | No |
| 4 | Release + client queue + Approve | 4 | Medium | **Yes** |
| 5 | Request-changes form + rounds | 3 | Medium | Yes |
| 6 | Accept / deny / replace / re-release | 4 | Medium | Yes |
| 7 | Deadline cron + auto-approve + lock | 2 | Low | Yes |
| 8 | Billing accrual + invoice injection | 3 | **High** | Yes |

Phases 0–3 ship to production invisibly. Nothing reaches a client until Phase 4.

---

## Phase 0 — Prep and decisions

No feature code. Clears blockers so Phase 1 doesn't stall.

### Slice 0.1 — Verify migration 014
**Status: done.** `select inactive_at from invoices limit 1;` returned a row with `inactive_at: null`. Column exists, 014 is applied, next migration number is **015**.

### Slice 0.2 — Storage TTL bug
**Status: done, with a different outcome than expected.**

`UPLOAD_URL_TTL_SECONDS = 60` could not be wired up as intended. The Supabase SDK's `createSignedUploadUrl` accepts no expiry argument — its signature is `(path, options?: { upsert: boolean })` and the expiry is set server-side at a fixed two hours. The constant was dead code carrying a doc comment that asserted behavior which had never been in effect.

Resolution: constant removed, real behavior documented in the function's docblock. `DOWNLOAD_URL_TTL_SECONDS` is untouched — that one is genuinely passed to `createSignedUrl`, which does accept `expiresIn`.

**No 60-second mechanism was built, and none should be.** Signed upload URLs are usually a risk because they go to untrusted parties. These don't — `createFileUploadUrlAction` is behind `requireOwner()`, so Kelsey is the only person who ever holds one. The same applies to content uploads in Phase 1. The real protections are the path-prefix tamper check and the verify-object-landed step in finalize, both unaffected.

### Slice 0.3 — Storage bucket
**Status: decided — new `content-assets` bucket.**

The client Files page lists rows from the `files` table, and review photos are not deliverables. Separate buckets make it structurally impossible to cross-wire a signed path between the two features.

Implemented in Phase 1: `lib/storage.ts` now takes a trailing defaulted `bucket: StorageBucket = FILES_BUCKET` parameter on all five functions. Because the parameter is trailing and defaulted, **no call site needed editing** — all 17 external references compile and behave identically. Zero regression surface on the files feature.

---

## Phase 1 — Schema, types, owner CRUD (photos only)

Everything stays in `drafting`. No client visibility. No video.

### Slice 1.1 — Migration 015
**Status: written and amended. Awaiting manual run in the SQL Editor.**

Five tables per spec §3.8: `content_cycles`, `content_items`, `content_assets`, `revision_rounds`, `revision_notes`.

Four constraints were added beyond what spec §3.8 listed. All four are now reflected back in the spec:

| Constraint | Why |
|---|---|
| `content_cycles` — `unique (client_id, month)` | Enforces one-row-per-client-per-month at the DB level rather than in application code. |
| `content_assets` — `status: processing\|ready\|failed` default `'ready'` | Spec §3.5b requires transcoding state; §3.8 omitted the column. Defaults to `ready` so photo uploads need no special handling; only Stream video ever inserts as `processing`. |
| `content_assets` — `unique (content_item_id, position) where replaced_at is null` | One *current* asset per carousel position. Partial, because `replaced_at` versioning deliberately keeps superseded rows at the same position. Makes the Phase 6 accept-a-revision flow fail loudly if it inserts a replacement without stamping the old row. |
| `revision_rounds` — `unique (content_item_id, round_number)` | A double-submit or a retry-after-timeout could otherwise open two round-2 rows on one item and accrue two billable charges for one batch of feedback. |

Also correct in the written migration, and better than specified: `revision_rounds.invoice_id` uses `on delete set null`, not cascade. Deleting an invoice must not erase the record that a revision happened — it returns the round to the unbilled pool.

Conventions to match, all from `supabase/migrations/001_initial_schema.sql`:
- Text columns with CHECK constraints, not Postgres enums (header lines 27–28)
- No triggers, no functions (lines 25–26)
- `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` for idempotency
- Fail-closed RLS block at the end — `alter table ... enable row level security;` with **no policies**, matching lines 598–627. All five tables are client-facing.
- Indexes on `client_id`, `cycle_id`, `scheduled_for`

If the new bucket was chosen in 0.3, create it here: `public=false`, no storage RLS, signed URLs only — matching the `client-files` bucket creation at `001_initial_schema.sql:583–585`.

**Additive only.** Nothing existing is modified.

**STOP.** Tanner runs 015 in the SQL Editor against prod and confirms with a verify query before anything else is built.

### Slice 1.2 — TypeScript types
**Status: done.** Six unions, five `*Record` interfaces, five `Database.Tables` entries. Typecheck and build clean.

Hand-maintained, no codegen. In `lib/supabase.ts`:
- Five `*Record` interfaces alongside the existing ones (lines 59–384)
- Union types beside the existing ones (lines 3–57): `ContentCycleStatus`, `ContentItemStatus`, `Platform`, `PostFormat`, `AssetProvider`, `RevisionCategory`
- Five `Database.Tables` entries via `TableShape` (lines 386–436)
- Provenance doc-comments on each — "Added in migration 015" — matching the existing convention

### Slice 1.3 — Owner content surface
A list view grouped by date. Not the calendar — that's Phase 3.

Reuse directly:
- `SlidePanel` (`app/owner/clients/_components/SlidePanel.tsx`) for the item editor. Constraint documented at lines 56–58: body scroll-lock is not re-entrant, never open two at once.
- `ConfirmDialog` (`components/ui/ConfirmDialog.tsx`) for deletes
- `StatusPill` (`components/ui/StatusPill.tsx`)
- The desktop-row / mobile-card split pattern from `InvoicesTable.tsx:49–97` over the generic primitives in `components/ui/MobileCard.tsx`

Copy the pattern, not the component, for status filtering — `StatusFilterPills` hard-codes its `ITEMS` list and invoice hrefs at lines 16–34.

CRUD for cycles and items: date, platform, format, caption.

**Timezone:** `scheduled_for` must be built with `combineDateAndTimeInTimezone` (`app/owner/calendar/_lib/timezone.ts:388–412`). This trap has been hit in this codebase before.

### Slice 1.4 — Photo upload
Clone the three-step files flow end to end:

1. **Mint** — server action guarded by `requireOwner()` (`lib/auth.ts:10`), pattern from `createFileUploadUrlAction` (`app/owner/clients/[id]/_actions.ts:69–97`) and `buildStoragePath` (`lib/storage.ts:39–42`). Pass `CONTENT_ASSETS_BUCKET`. No TTL argument exists — see slice 0.2.
2. **Upload** — browser XHR PUT direct to the signed URL for progress events, pattern from `uploadFileWithProgress` (`FilesPanel.tsx:44–72`) driven by `handleUpload` (lines 193–255). Nothing is persisted before this; an abandoned PUT leaks nothing.
3. **Finalize** — re-guard, reject tampered path prefixes (pattern at `_actions.ts:134`), verify the object actually landed via `readUploadedObjectMetadata` (`lib/storage.ts:147–176`), then insert the `content_assets` row with verified metadata

Carousels are multi-asset — `content_assets.position` ordering matters here, not later.

**Done when:** Kelsey can build a full month of photo posts in production and no client can see any of it.

---

## Phase 2 — Cloudflare Stream, owner-side

The highest-risk phase. Nothing in the codebase resembles this. Built before any surface area depends on it.

### Slice 2.1 — Account and environment
Cloudflare account, Stream enabled, payment method on file. Per spec §9, the card is the Amex under the LLC, not personal.

Env vars follow the house convention — every other secret is an env var, and `resolveBaseUrl()` (`lib/baseUrl.ts`) already requires `NEXT_PUBLIC_APP_URL` in production. Account ID, API token, and the URL signing key all go in env, not the database.

### Slice 2.2 — `lib/stream.ts`
Mirror the shape of `lib/storage.ts` — same module posture, same doc-comment density. Four functions:

| Function | Notes |
|---|---|
| Mint Direct Creator Upload URL | `requireSignedURLs: true`, `maxDurationSeconds ≈ 120`. Per spec §3.5d, the reserved duration counts against the storage block until upload completes or the link expires. |
| Poll `readyToStream` | Spec §3.5b. Uploaded ≠ playable. |
| Mint signed playback token | Short-lived, minted only after ownership verification. Spec §3.5a. |
| Delete video | Spec §3.5c. No FK protects this; an orphan leaks silently. |

**This is the one module worth targeted tests.** There is no test infrastructure anywhere in the repo — this plan does not propose building one. But `lib/stream.ts` is the single place a vendor contract can break silently and surface as a dead player in front of a client. Everything else fails loudly.

### Slice 2.3 — TUS upload with background continuation
Browser-side resumable upload. Persist the upload URL client-side so a refresh resumes mid-file rather than restarting.

Behavior per spec §3.7 — worth restating because the UI must not promise more than the platform delivers:

| Scenario | Behavior |
|---|---|
| Navigating inside the portal | Continues |
| Hard refresh / tab close | Stalls, resumes on return |
| iPhone Safari backgrounded or locked | Stalls, resumes on return |

Upload failures surface a clear, retryable notification. They do not fail silently.

### Slice 2.4 — Processing state and owner playback
`content_assets` carries a processing state until `readyToStream` flips. Poll it using the existing house mechanism: `useVisibilityPolling` (`lib/hooks/useVisibilityPolling.ts`, `DEFAULT_POLL_INTERVAL_MS = 30_000` at line 9) against a route guarded per `lib/auth.ts`. At 6–15 second clip lengths this should resolve in seconds — a shorter interval may be warranted here than the 30s used by messages.

Owner-side playback of ready assets, 9:16 vertical.

**Done when:** Kelsey uploads a 4K clip on desktop Chrome, it transcodes, and she plays it back in the portal. Storage is confirmed billing as expected in the Cloudflare dashboard.

---

## Phase 3 — Calendar extraction + content calendar

### Slice 3.1 — Parameterize `MonthView`
The grid is already presentational — `app/owner/calendar/_components/MonthView.tsx` takes `{ monthKey, events, now? }` and fetches nothing. Four coupling points remain:

1. **`CalendarEvent.source`** (`app/owner/calendar/_lib/types.ts:40–70`) — a union of exactly `shoot | time_block | external`. Either widen it with a `content_item` variant, or define a minimal generic event shape the calendar types satisfy.
2. **`MonthEventPill`** — hard-codes the owner-calendar edit URL at line 15, Google external link-out at 71–84, and pulls colors from `visualsForEvent` in `_lib/eventColors.ts`, keyed on the shoot/time-block vocabulary. Smallest fix is a `renderEvent` render prop or an injected visuals mapping.
3. **Day-cell hrefs** — `MonthView.tsx:79` builds a link into the owner calendar's DayPanel, used at line 99 (empty cell) and 154 (overflow "+N more"). Both need injecting.
4. **Location** — currently under `app/owner/calendar/_components/`. The house convention is that shared code moves to neutral `lib/` / `components/`. The client review queue is a *queue*, not a calendar, so owner-side may be sufficient — decide before moving.

Already pure and reusable as-is: `monthGridDateKeys` / `dateKeyInMonth` (`_lib/timezone.ts:305–315, 324–326`) and `dateKeyInTimezone` (`lib/date.ts:29–40`). String math, no server-local Date reads.

**Risk:** this touches the live owner calendar, which has no tests. The extraction is mechanical, but `eventColors.ts` and the DayPanel deep-links are load-bearing. Regression-check the existing calendar manually before moving on.

### Slice 3.2 — Content item mapper
A fourth mapper alongside `shootToEvent` / `timeBlockToEvent` / `externalEventToEvent` (`app/owner/calendar/_lib/queries.ts:128–195`), assembled in `fetchEventsInRange` (lines 59–126). The audit notes this isolation was designed so a new source only touches the mapper.

### Slice 3.3 — Kelsey's content calendar view
Month grid fed from `content_items`, with the all-clients / single-client filter toggle from spec §4.1. 9:16 thumbnails inside day cells — the audit does not address this and it is the hardest layout problem in the feature.

**Done when:** Kelsey builds a month from the calendar view and the existing owner calendar is unchanged in behavior.

---

## Phase 4 — Release + client queue + Approve

**First client-visible phase.** Everything before this was invisible.

### Slice 4.1 — Release action
Per spec §4.2: per-client, per-cycle, single action. Blocked until every asset in the cycle is `ready` — otherwise clients open dead players. Sets cycle to `in_review`. Includes unrelease and re-release (spec §4.4), which must preserve client progress because the deadline is a stored timestamp, not a countdown.

### Slice 4.2 — Release email
New builder module over `buildShell` (`lib/messageEmails.ts:9–93`), following `lib/invoiceEmails.ts` (builders at :11, :52, :90). All interpolations through `lib/escapeHtml.ts`. Link via `resolveBaseUrl()` + the client path.

**Blocked on the client nav label** — the URL path can't be written until it's named.

Note: every existing send site constructs `new Resend(...)` inline with the same `from` fallback. There is no shared wrapper. Match the existing pattern rather than introducing one mid-feature.

### Slice 4.3 — Client review queue
Resumable by construction — progress is just per-item status, so no separate progress table is needed.

Ownership enforcement per the two house patterns, since **there are no RLS policies and no browser-side Supabase queries anywhere** (`getSupabaseBrowserClient` at `lib/supabase.ts:448–455` has zero call sites):
- **Pattern A** — ownership in the query. Example: `fetchMyInvoiceById` (`app/client/invoices/_lib/queries.ts:92–108`) returns `null` identically for missing, not-yours, and filtered rows so nothing leaks "exists but not yours."
- **Pattern B** — fetch then compare. Example: `createFileDownloadUrlAction` (`app/client/files/_actions.ts:22–60`, check at 47–49).

Signed playback token minting is Pattern B verbatim: verify the requesting client owns the item, then mint.

**Design constraint:** some clients are older and less technically confident. Simplicity governs every decision on this surface.

### Slice 4.4 — Approve + Kelsey's rollup
Per-item Approve. Kelsey's approved / revised / untouched counts (spec §4.5), arriving via `useVisibilityPolling` against a guarded route.

**Done when:** a real cycle is released to one client, they approve items, and Kelsey sees the counts move.

---

## Phase 5 — Request-changes form + rounds

### Slice 5.1 — Guided form
Preset categories (clips, caption, music, pacing, text overlay, cover, schedule, other), a comment field per selected category, and timestamp notes anchored to a point in the video via the scrubber. Writes `revision_rounds` and `revision_notes`.

Guided categories exist because free-text feedback produces unactionable notes.

### Slice 5.2 — Per-item submit and lock
Spec §5.4. The client submits each item individually. **A submitted item is locked and cannot be reopened.** They continue through the rest of the queue, but a sent item is closed.

This is the mechanism the whole design rests on. Without it, feedback dribbles in indefinitely and the round structure is meaningless.

There is no global submit button.

### Slice 5.3 — Arrival on Kelsey's side
Submitted items appear for Kelsey immediately, via the same polling mechanism. Seeing a request does not obligate her to act on it.

**Done when:** a client submits change requests on some items and approves others, and Kelsey sees both.

---

## Phase 6 — Accept / deny / replace / re-release

### Slice 6.1 — Accept and replacement upload
New version uploaded through the Phase 2 Stream path. Side-by-side playback of current vs. new before committing.

### Slice 6.2 — Delete-on-replace
On accept: the superseded Stream video is explicitly deleted, and `content_assets.replaced_at` records the version history.

**This needs deliberate design, not pattern-copying.** The house contract is DB-row-first, storage-delete-best-effort (`deleteFileAction`, `app/owner/clients/[id]/_actions.ts:232–268`) — an orphaned Supabase object is accepted as cheap. A Stream orphan is not cheap: it consumes storage minutes indefinitely and is invisible from inside the app. The ordering and the failure path both need thought.

### Slice 6.3 — Deny
Requires a written reason and a confirmation step, using `ConfirmDialog` with `variant: danger`. The client sees the reason.

### Slice 6.4 — Working state and re-release
Client is locked out of further action while Kelsey works, and sees an informative state (spec §4.8). Re-release opens the next round.

**Done when:** a full round-1 cycle completes end to end — release, review, submit, accept, re-release.

---

## Phase 7 — Deadline cron + auto-approve + lock

The safest new code in the feature. Pure pattern copy.

### Slice 7.1 — Cron route
`app/api/cron/content-deadlines/route.ts` copying the guard contract from `app/api/cron/unread-reminders/route.ts:11, 23–31`: `export const dynamic = "force-dynamic"`, GET handler rejecting unless `Authorization === Bearer ${process.env.CRON_SECRET}`, work in a helper returning a JSON summary, 500 with message on throw.

One new entry in `vercel.json` alongside the two existing daily jobs. `CRON_SECRET` already exists; Vercel injects the header automatically.

Sweep: cycles past `revision_deadline` still in `in_review` → untouched items flip to approved with `approved_by = 'auto'`, cycle → `locked`.

Schedules are UTC, but `revision_deadline` is `timestamptz` compared against `now()`, so the sweep is correct regardless of run hour. The only tuning decision is how soon after a Central-time deadline the lock lands. **Unverified:** Vercel Hobby-plan cron may only guarantee daily granularity, which would rule out an hourly sweep without a plan change.

**Idempotency matters** — the sweep must be safe if it runs while Kelsey is mid-edit.

### Slice 7.2 — Manual lock
Kelsey's Lock-now override (spec §4.6), for when a client confirms they've finished early.

**Blocked on the default deadline length** — needed for the cycle-creation default, not for the sweep logic.

**Done when:** a test cycle with a past deadline auto-locks on the next cron run.

---

## Phase 8 — Billing accrual + invoice injection

Money. Last, and deliberately isolated.

### Slice 8.1 — Consent confirmation
Round-2+ price shown before submission, naming the round number and the amount added to the next invoice. `ConfirmDialog` fits without changes. This is captured consent and is what prevents billing disputes.

**Blocked on `extra_round_price` and on the wording** — spec §5.8 requires the framing not feel punitive, and that copy is undecided.

### Slice 8.2 — Accrual and Kelsey's view
A billable round accrues as an unbilled charge flagged to the client. Kelsey sees it immediately, as pending — **not as income**. The fully-denied-round exemption (spec §6.1) applies here.

### Slice 8.3 — Invoice line-item injection
**The only genuinely unprecedented plumbing in this feature.** There is no existing injection or suggestion mechanism inside the invoice form — nothing currently pre-populates line items from elsewhere.

Existing shape: `LineItemDraft[]` state (`InvoiceFormPanel.tsx:45–59`), row editor (377–451), max 20 items, client-side validation (173–222), server re-validation in `validateLineItems` (`app/owner/invoices/_actions.ts:61–96`), stored as JSONB on `invoices.line_items` (`001_initial_schema.sql:219`, typed at `lib/supabase.ts:145`).

The closest house pattern is the financials suggestions system (`app/owner/financials/_lib/suggestions.ts`) — server-computed suggestion arrays passed as props, accept/dismiss routed by `referenceId`.

Two plumbing options, both unprecedented in this panel: prop-drill through `InvoicesBoard` (`_components/InvoicesBoard.tsx:81–88`), or fetch via server action when `values.clientId` changes. Precedent for client components calling data-returning actions exists (`createInvoicePdfDownloadUrlAction`).

Then: `createInvoiceAction` / `updateInvoiceAction` (`_actions.ts:141–216, 230–355`) accept optional round IDs and stamp `revision_rounds.invoice_id` after the invoice write.

**What does not change: the payment pipeline.** Both the Stripe webhook (`app/api/webhooks/stripe/route.ts:196–209`) and `markInvoicePaidAction` (`app/owner/invoices/_actions.ts:526–546`) derive income from the invoice total — Stripe's session total, or the line-item sum — and never inspect individual line items beyond summing. A revision charge added as one more `{description, amount}` entry rides through the webhook, the income insert, the receipt PDF (which iterates line items generically, webhook 243–266), and cash-basis timing with zero modification.

**Done when:** a billable round appears in the invoice builder, gets added, the invoice is paid, and income posts once at the correct amount.

---

## Blocking decisions

| Decision | Blocks | Status |
|---|---|---|
| Storage bucket | Phase 1 | **Decided** — new `content-assets` bucket |
| Owner nav label | Phase 1 (route path) | **Decided** — "Content", route `/owner/content` |
| Client nav label | Phase 4 (email URL) | Not decided |
| Default deadline length | Phase 7 | Not decided |
| `extra_round_price` | Phase 8 | Not set |
| Round-2+ framing and wording | Phase 8 | Not decided |
| Contract language | **Before any client sees Phase 4** | Not done |

**The contract item is not a software task and it is the one that can't be caught up later.** The revision cap, deadline, and extra-round price must be in the client agreement before the software starts enforcing them. Phase 4 is the deadline for it.

---

## Standing conventions

Applies to every phase.

- **Migrations are additive only.** Run manually in the SQL Editor against prod, verified with a post-run query, **before** the Vercel deploy that ships the dependent UI.
- **RLS: enabled, no policies.** Authorization is app-layer. New client-facing tables get the `enable row level security` block and nothing more.
- **Types are hand-maintained.** Every migration that touches a column also edits `lib/supabase.ts`. Query results are cast, so drift is caught by discipline, not the compiler.
- **Design system is strict.** Cream `#E8E4D8`, forest `#1B3827`, mauve `#A8788A`, near-black `#1A2B1C`. Playfair Display for headings only, DM Sans for everything else. Zero border-radius, no shadows, no gradients, no blur.
- **Desktop and mobile both.** Row-plus-card over `MobileCard` primitives, matching `InvoicesTable.tsx:49–97`.
- **All media is 9:16 vertical.** Never cropped to square or 16:9.
- **PowerShell** for all terminal commands.
- **Claude Code does not deploy.**

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Stream vendor contract breaks silently → dead player in front of a client | 2 | Targeted tests on `lib/stream.ts`. The only module in this plan that warrants them. |
| Regressing the live owner calendar during extraction | 3 | No tests exist. Manual regression check before proceeding. |
| Stream orphans accumulating invisibly | 6 | Deliberate delete-on-replace ordering. The house best-effort pattern is insufficient here. |
| Invoice injection breaking existing invoice creation | 8 | Isolated to its own phase. Payment pipeline provably untouched. |
| Client-facing UX too complex for older clients | 4, 5 | Design pass before build. The Claude Design prompt from the planning thread is stale and needs rewriting against the final spec. |
| Cron granularity insufficient on current Vercel plan | 7 | Verify plan before relying on sub-daily sweeps. |

---

## Not in this plan

Deferred by decision, recorded so they aren't lost:

- Monthly database export to a zipped JSON file emailed off-platform. Separate from this feature; deferred in favor of Supabase Pro daily backups.
- Digest email, bulk approve, copy-caption button — raised in earlier planning, never decided.
- Retention or auto-deletion of Stream videos. Storage math says it will not become a cost factor.
- Test infrastructure beyond `lib/stream.ts`.
- Any form of social publishing. The portal never posts anywhere.

---

*Plan complete. Phase 0 slices 0.2 and 0.3 are the immediate next actions.*