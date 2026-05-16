# DBS Portal — Messages Feature Spec
**Reference document for Claude Code implementation**
*Version 1.0 — May 2026*

---

## Purpose

This document captures every design and architecture decision for the Messages feature, made before any implementation work begins. It is the source of truth for all Copilot/Claude Code prompts going forward. If a prompt contradicts this doc, the doc wins — flag it and ask before implementing.

The Messages feature replaces three placeholder surfaces with one cohesive system:
- `/owner/messages` — Kelsey's inbox (split view: client list left, thread right)
- `/client/messages` — single thread for the logged-in client
- Client-detail Messages tab — same thread embedded in the existing tab layout

Plus a fourth contextual surface: a `<QuickMessageButton />` on the client booking page (and reusable elsewhere later).

---

## 1. Architecture

### 1.1 Auth helper centralization (prerequisite — already complete)
- `lib/auth.ts` exports `requireOwner()` (server-action shape, always returns `ownerLabel` on success) and `requireOwnerApi()` (NextResponse-or-null API-route shape).
- All four Messages API routes use `requireOwnerApi()` (owner-only routes) or check role manually for routes accessed by both roles.

### 1.2 API routes (not server actions)
All Messages operations are HTTP API routes under `app/api/messages/`. This is a deliberate departure from the rest of the codebase's server-action-for-mutations convention. The reason: polling needs real HTTP endpoints, and keeping all four operations in one pattern (rather than mixing actions + routes) gives the Messages feature one mental model.

**Four endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/messages?clientId=X&since=ISO_TIMESTAMP` | Fetch thread messages. `since` is optional; if omitted, returns full thread. |
| `POST` | `/api/messages` | Send a message. Body: `{ clientId, body }`. Owner sends to a specific client; client sends to their own thread (`clientId` is derived from auth, ignored if provided). |
| `PATCH` | `/api/messages/read` | Mark thread as read. Body: `{ clientId }`. Sets `read_at = now()` for all unread messages in that thread *from the other party*. |
| `GET` | `/api/messages/unread-counts` | Owner: returns `{ counts: { [clientId]: number }, total: number }`. Client: returns `{ count: number }`. Role determined by caller's Clerk publicMetadata. |

**Response conventions** (match existing repo pattern):
- Success: resource-named key (`{ messages }`, `{ message }`, `{ counts, total }`)
- Failure: `{ error: string }` with appropriate status code
- Status codes: 200 success, 201 create, 400 validation, 401 no session, 403 wrong role, 500 DB error, 502 third-party (Resend) failure

---

## 2. Polling

### 2.1 Implementation
Vanilla `useEffect` + `setInterval`. No SWR, no React Query, no new dependencies.

### 2.2 Interval & visibility behavior
- **30-second interval** while tab is visible
- **Visibility pause**: when `document.visibilityState === 'hidden'`, fire one final poll, then pause
- **Resume on visible**: when tab becomes visible, fire immediate poll, then resume 30s cadence
- **Manual refresh button** in the thread UI — user can force a poll without waiting for the interval

### 2.3 Fetch strategy
- **Full refetch** each poll (`GET /api/messages?clientId=X` without `since`)
- `?since=` parameter still accepted server-side for future incremental fetching, but not used by client in v1
- Rationale: threads are small (B2B context, <few hundred messages typical), full refetch is bulletproof, no client-side merge logic needed

### 2.4 Seamless rendering requirement
Polling must not cause visible UI disruption. Specifically:
- **Stable keys**: always use `message.id` as the React key, never index
- **No scroll jump**: scroll-to-bottom only fires when a *new* message arrives, not on every poll
- **No composer reset**: composer state is independent of message list state
- **No re-render flash**: replacing `messages` array on each poll is fine as long as IDs are stable (React reconciles correctly)
- **Optimistic message preservation**: when poll returns, merge logic is "server messages by ID + any local pending/failed messages not yet confirmed, sorted by `sent_at`"

---

## 3. Mark-as-read behavior

### 3.1 Triggers
- **On thread open**: when `<MessageThread>` mounts with at least one unread message from the other party → one `PATCH /api/messages/read` call
- **On new messages arriving while tab is visible**: when a poll returns messages newer than what we had, and `document.visibilityState === 'visible'` → fire another PATCH for the new messages
- **Tab hidden**: do NOT mark anything read. (Critical — otherwise visibility-pause behavior is undermined.)

### 3.2 Visibility to other party
**Read state is internal-only.** Neither party sees "Kelsey read your message at 2:14 PM" or any read receipt UI. `read_at` is used exclusively for unread counts and badges. This is intentional — read receipts have relationship/professional implications that may not fit Kelsey's preferences. Can be added later if she decides she wants it.

### 3.3 Reset on read (interacts with notifications — see §6)
`PATCH /api/messages/read` only stamps `messages.read_at`. The notification cooldown columns (`*_last_new_msg_email_at`, `*_last_reminder_email_at`) are deliberately **not** cleared — read state is independent of either cooldown (see §6.4). An earlier draft of this spec proposed clearing them; that idea was dropped because it would let a quick read/respond loop bypass the 24h throttle.

---

## 4. Owner inbox layout

### 4.1 Left pane: client list
- **Shows all clients except `status = 'inactive'`** (includes leads, active, and any other engaged status; excludes archived/inactive)
- **Sort order**:
  1. Clients with at least one message → by most recent `sent_at` desc
  2. Clients with no messages → alphabetical by name
- **Per-row content**:
  - Client name
  - Type badge (Brand/Bride)
  - Last message preview (truncated ~50 chars) OR muted "No messages yet" if no thread
  - Timestamp of last message (compact format — see §9)
  - Unread count badge (mauve pill, `--accent`) if `unread > 0`

### 4.2 Right pane: selected thread
- Renders `<MessageThread clientId={selectedClient.id} viewerRole="owner" />`
- If no client selected: empty state with prompt to choose a client

### 4.3 Inactive clients
v1: inactive clients don't appear in the messages list (historical messages still in DB, just not surfaced). If Kelsey wants to look back at archived conversations later, we'd add a "show archived" toggle. Not in scope for v1.

---

## 5. Unread badge (sidebar)

### 5.1 Owner side
- Polled via `GET /api/messages/unread-counts` on a 30s cadence with visibility-pause (same pattern as thread polling)
- Badge on "Messages" nav item shows `total` from response
- Runs at the layout level (`app/owner/layout.tsx` includes a `<UnreadBadgePoller />` client component)

### 5.2 Client side
- Same endpoint, same poller component
- Returns `{ count: number }` for client role (scoped to their own thread)
- Badge on client sidebar "Messages" nav item

### 5.3 `SidebarNavItem` extension
- Extend the type to include optional `badge?: number` prop
- Sidebar component renders a small mauve pill (`--accent` background, white text) on the active row; same color but muted opacity on inactive rows
- Generic implementation — future features (overdue invoices, pending booking requests) can use the same pattern

### 5.4 Implications
This is the first persistent background work in the app — every owner page now has a 30s fetch running. Visibility-pause keeps idle-tab cost low.

---

## 6. Email notifications (unread-aware)

### 6.1 Model
Notifications are split across **two independent systems**, each with its own **24-hour cooldown** per thread per recipient:

- **New-message emails** — fired by `POST /api/messages` after a send, throttled by `*_last_new_msg_email_at`.
- **Daily reminder emails** — fired by the cron at `GET /api/cron/unread-reminders` for any thread with lingering unread messages, throttled by `*_last_reminder_email_at`.

The two systems do not share state. Worst case: a recipient receives one new-message email and one reminder email within the same 24-hour window for the same thread (2 emails per 24h per thread per recipient).

### 6.2 Schema additions
Four columns on `clients`, all nullable / default null:

- `owner_last_new_msg_email_at timestamptz` — stamped by `POST /api/messages` when Kelsey is emailed about a new message from this client.
- `owner_last_reminder_email_at timestamptz` — stamped by the reminder cron when Kelsey is reminded about lingering unread messages from this client.
- `client_last_new_msg_email_at timestamptz` — stamped by `POST /api/messages` when this client is emailed about a new message from Kelsey.
- `client_last_reminder_email_at timestamptz` — stamped by the reminder cron when this client is reminded about lingering unread messages from Kelsey.

The first two were originally named `owner_last_notified_at` / `client_last_notified_at`; a one-shot `RENAME COLUMN` in `supabase/schema.sql` scopes them to the new-message system.

### 6.3 On send (in `POST /api/messages` handler)
After inserting the new message:

```
Look at the recipient's [recipient]_last_new_msg_email_at on the clients row.
  - If it is set AND less than 24 hours ago:
    - Skip email (cooldown active)
  - Otherwise:
    - Send email via Resend
    - UPDATE clients SET [recipient]_last_new_msg_email_at = now() WHERE id = ?
```

`[recipient]_last_new_msg_email_at` means "last time the new-message system emailed this recipient about this thread." It is independent of read state and independent of the reminder cron's cooldown.

### 6.4 On mark-as-read (in `PATCH /api/messages/read` handler)
Mark the `messages.read_at` timestamp for unread messages from the other party. Neither `*_last_new_msg_email_at` nor `*_last_reminder_email_at` is touched — both cooldowns are independent of read state, so reading a message does not unlock a fresh notification of either kind.

### 6.5 Daily reminder (Vercel Cron)
- **Route**: `GET /api/cron/unread-reminders`
- **Schedule**: once per day (recommend ~6pm CT, mid-evening, captures business-day messages)
- **Auth**: `CRON_SECRET` env var, verified via `Authorization: Bearer <secret>` header. Reject with 401 if missing or wrong. Vercel Cron automatically sends this header when the env var is set on the project.
- **Logic** (uses the reminder-only `*_last_reminder_email_at` columns; the new-message cooldown is untouched):
  1. Find all non-`inactive` `clients` where:
     - Owner side: exists unread message with `sender_role = 'client'` for this client_id AND `owner_last_reminder_email_at IS NULL OR owner_last_reminder_email_at < now() - interval '24 hours'`
     - Client side: exists unread message with `sender_role = 'owner'` for this client_id AND `client_last_reminder_email_at IS NULL OR client_last_reminder_email_at < now() - interval '24 hours'`

     Both reminders can fire in the same run for the same client when there are unread messages in both directions.
  2. For each match, send reminder email via Template B.
  3. On a successful Resend send, `UPDATE clients SET [side]_last_reminder_email_at = now() WHERE id = ?`. On Resend failure, do not stamp the column — the next cron run will retry.
- **Response**: `{ remindersSent, errors, suppressed }` summary.
- **Vercel config**: `vercel.json` with cron entry:
  ```json
  {
    "crons": [
      {
        "path": "/api/cron/unread-reminders",
        "schedule": "0 23 * * *"
      }
    ]
  }
  ```
  (23:00 UTC ≈ 6pm CT — adjust for DST handling if needed; cron schedules are in UTC.)

### 6.6 Email content (notify-only — no message preview)
**Two templates**, both branded the same way as the existing invite email (forest header, cream body, deep-forest footer, Playfair + DM Sans, sharp corners).

**Template A — new message**
- Subject: `New message from [sender name] — Digital Bloom Socials`
- Body copy: "You have a new message from [sender] waiting in your portal."
- CTA button: "Open Portal" → links to `/owner/messages` (for Kelsey) or `/client/messages` (for client)

**Template B — daily reminder**
- Subject: `You still have unread messages — Digital Bloom Socials`
- Body copy: "You have unread messages from [sender] in your portal."
- Same CTA button as Template A

**Why notify-only**: this is a business portal handling contracts, scheduling, invoices. Email is a notification layer, not a content channel. Forces engagement with the portal (the source of truth), and avoids stale message previews sitting in inboxes after the user has already responded.

### 6.7 Email template structure
- Reuse the patterns from `buildInviteEmailHtml` in `app/api/invite/route.ts:51`
- Same inline-style approach, same color tokens hardcoded as hex
- Reuse the hand-rolled `escapeHtml` helper (extract to a shared util — `lib/email.ts` is a reasonable home, but defer that refactor to keep this contained)
- For v1, build the new templates inline in the route files that use them; if a third template needs the same scaffolding later, extract then

### 6.8 Resend integration
- Same config as invite route: `RESEND_API_KEY` and `RESEND_FROM_EMAIL` env vars
- Resend failure does NOT roll back the message send — the message is stored, the email failed. Return 207 Multi-Status with `{ message, warning: "Email notification failed" }` to match the existing invite-route pattern.

---

## 7. Composer behavior

### 7.1 Keyboard
- **Enter** = send
- **Shift+Enter** = newline
- Hint below composer (small muted text): `Enter to send · Shift+Enter for newline`

### 7.2 Validation
- Send button **disabled** when textarea is empty or whitespace-only (after trim)
- Trim whitespace before sending (don't store leading/trailing whitespace in DB)

### 7.3 Optimistic rendering
On send (before API responds):
1. Generate a temporary client-side ID (e.g., `temp-${crypto.randomUUID()}`)
2. Append message to local state with `pending: true` flag, temp ID, `sent_at = new Date().toISOString()`
3. Clear composer
4. Refocus textarea
5. Scroll thread to bottom
6. Fire `POST /api/messages` in parallel

On response:
- **Success**: replace optimistic message with server response (real ID, server `sent_at`). The replacement should be by temp ID match — find the pending message with this temp ID, swap it out.
- **Failure**: mark optimistic message as `failed: true`, show with red border + "Retry" button. Composer is already cleared, so the user's text is preserved in the failed message bubble (clicking Retry resends).

### 7.4 Optimistic + polling interaction
When a poll returns:
- Merge logic: server messages by ID + any local messages with `pending: true` or `failed: true` not yet in the server list
- Sort merged list by `sent_at` ascending
- Stable keys via message ID (temp IDs for optimistic, real IDs for confirmed)

### 7.5 Defaults (no configuration needed)
- **Auto-resize textarea** up to ~6 lines (max-height with overflow-auto)
- **No character limit** in v1 (Postgres `text` field, no practical limit)
- **Plain-text paste** — browser default for textarea, no rich text handling

---

## 8. Timestamp formatting

### 8.1 New file: `lib/formatRelativeTime.ts`
Two exported formatters. No new dependencies.

**`formatMessageTimestamp(date: Date | string): string`** — used at cluster boundaries in the thread
- Today: `2:14 PM`
- Yesterday: `Yesterday 2:14 PM`
- This week (within 7 days): `Tuesday 2:14 PM`
- Older, same year: `Apr 8, 2:14 PM`
- Older, different year: `Apr 8, 2024`

**`formatInboxTimestamp(date: Date | string): string`** — used in the owner inbox list
- Today: `2:14 PM`
- Yesterday: `Yesterday`
- This week: `Tue`
- This year: `Apr 8`
- Older: `Apr 8, 2024`

Both use `toLocaleString` patterns consistent with existing `app/owner/clients/_lib/format.ts`. No relative ago-strings ("2 hours ago") — those go stale on idle tabs and need re-rendering logic; the calendar-relative format is clearer for messaging anyway.

### 8.2 Message clustering in thread
- A "cluster" is consecutive messages from the same sender within a **5-minute window**
- Show one timestamp at the **top of each cluster only**, not on every message
- A new cluster starts when:
  - Sender changes (owner → client or vice versa), OR
  - 5+ minutes elapsed since previous message
- Cluster timestamp uses `formatMessageTimestamp`

### 8.3 Live updates
Timestamps recompute on every poll (free, since we re-render the message list anyway). Handles the midnight rollover and "Today → Yesterday" transition automatically.

---

## 9. `<MessageThread>` component (shared)

This is the core reusable component. Used in three places: `/owner/messages` right pane, `/client/messages`, client-detail Messages tab. One implementation, three contexts.

### 9.1 Props
```ts
interface MessageThreadProps {
  clientId: string;          // which thread to load
  viewerRole: "owner" | "client";  // determines API call shape and message alignment
  initialMessages?: MessageRecord[];  // optional SSR preload
}
```

### 9.2 Internal state
- `messages: MessageRecord[]` — current thread state
- `composer: string` — composer textarea value
- `pendingMessages: PendingMessage[]` — optimistic messages awaiting confirmation
- `failedMessages: FailedMessage[]` — messages that failed to send
- `isPolling: boolean` — whether polling is active (false when tab hidden)

### 9.3 Layout
```
┌─────────────────────────────────────────┐
│  Thread header (client name + actions)  │ ← only in /owner/messages context
├─────────────────────────────────────────┤
│  [refresh button]                       │
├─────────────────────────────────────────┤
│                                         │
│         message clusters here           │
│         (scroll if overflow)            │
│                                         │
├─────────────────────────────────────────┤
│  [textarea ─────────────────] [Send]   │
│  Enter to send · Shift+Enter for newline│
└─────────────────────────────────────────┘
```

### 9.4 Message bubble styling
- **Sent by viewer** (own messages): right-aligned, forest green background (`--sidebar-bg`), cream text
- **Sent by other party**: left-aligned, cream raised background (`--surface-raised`), dark text
- **Pending**: 60% opacity, no border change
- **Failed**: red border + small "Retry" link below the bubble
- **Sharp corners** (no border-radius — repo convention)
- **No shadows** — repo convention

### 9.5 Empty state
"No messages yet. Send the first one below." Above the composer, centered, muted.

---

## 10. `<QuickMessageButton />` (reusable component)

### 10.1 Purpose
Contextual access to the messages thread without leaving the current page. First use is on `/client/book` (replacing the existing `MessageKelseyButton.tsx`), but designed to be droppable elsewhere on the client side later.

### 10.2 Behavior
- Click button → inline expand animation (panel grows out from button location, pushes surrounding content down)
- Panel contents:
  - Top bar: close button (X), label "Messages", "Open full page →" link (navigates to `/client/messages`)
  - Middle: full `<MessageThread>` component
  - Bottom: composer (part of `<MessageThread>`)
- Click X or click outside → collapse with smooth animation

### 10.3 Animation
- Smooth height transition (CSS `transition` on max-height or via Framer Motion if already in deps — check first; if not, plain CSS transition)
- Surrounding content shifts naturally as the panel expands

### 10.4 Reusability
- Accepts a prop `animationStyle: "inline-expand" | "slide-drawer"` (default: `"inline-expand"`)
- v1 only implements `inline-expand`; `slide-drawer` is a placeholder for future contexts
- When/if we add a second usage, we decide per location which style fits

### 10.5 Replace existing button
- `app/client/book/_components/MessageKelseyButton.tsx` → rewire to use `<QuickMessageButton />` (or delete and have the booking page import `<QuickMessageButton />` directly)
- Remove the ConfirmDialog with the "messages aren't available yet" copy

---

## 11. Data model (schema additions)

### 11.1 Existing `messages` table (no changes)
Already complete in `supabase/schema.sql`. Confirmed fields:
- `id`, `client_id`, `sender_role`, `body`, `sent_at`, `read_at`
- Indexes on `client_id` and `sent_at`
- No RLS (schema convention — app-level scoping via service-role client)

### 11.2 New columns on `clients`
```sql
-- One-shot rename (originally owner_last_notified_at / client_last_notified_at)
alter table clients rename column owner_last_notified_at to owner_last_new_msg_email_at;
alter table clients rename column client_last_notified_at to client_last_new_msg_email_at;

-- Reminder cron has its own independent cooldown
alter table clients
  add column if not exists owner_last_reminder_email_at timestamptz,
  add column if not exists client_last_reminder_email_at timestamptz;
```

All four nullable, default null.

### 11.3 TypeScript types
- `MessageRecord` already exists in `lib/supabase.ts` — no changes needed
- `ClientRecord` will gain the two new fields (extend the existing type definition)
- Add `MessageRecord & { pending?: boolean; failed?: boolean; tempId?: string }` as a UI-only type within the component file (not in the DB type)

---

## 12. Build order

Each phase is independently shippable and QA-able.

| # | Phase | Notes |
|---|---|---|
| 1 | **Schema migration** | Add two `clients` columns. Tiny standalone migration. |
| 2 | **Core API routes** | All four endpoints. No UI yet, test with curl/Thunder Client. |
| 3 | **`<MessageThread>` component** | Shared component used in three places. Build and test on a scratch page with hardcoded clientId. |
| 4 | **Client-detail Messages tab** | Drop `<MessageThread>` into existing tab placeholder. First real surface, easiest to QA. |
| 5 | **`/owner/messages` page** | Left pane inbox + right pane thread. Uses unread-counts endpoint. |
| 6 | **`/client/messages` page** | Single thread for logged-in client. |
| 7 | **Sidebar badge** | Extend `SidebarNavItem`, build `<UnreadBadgePoller />`, wire into both sidebars. |
| 8 | **Resend integration on send** | Unread-aware logic, new-message email template. |
| 9 | **Vercel Cron + reminder route** | Daily job, reminder email template. |
| 10 | **`<QuickMessageButton />`** | Rewire booking page button, inline-expand animation. |

---

## 13. Out of scope for v1

Explicit defers — do not build these:
- Read receipts visible to the other party
- Typing indicators
- Message editing or deletion
- Attachments / file uploads in messages
- Search across messages
- Browser notifications, sound alerts
- Supabase Realtime (polling only in v1, per blueprint §6.6)
- Message reactions (emoji, etc.)
- Archived-client message access (no "show archived" toggle yet)
- Per-message read tracking via IntersectionObserver
- Incremental fetch via `?since=` from the client (server-side param exists for future use)
- Rich text / markdown rendering in messages
- Character limits / soft warnings
- Bride-specific message routing (foundation works for both client types as-is)

---

## 14. Existing patterns to mirror

From the research report — patterns to follow without re-inventing:

- **Auth on API routes**: `const authError = await requireOwnerApi(); if (authError) return authError;`
- **Auth on server actions** (none in this feature, but for context): `const guard = await requireOwner(); if (!guard.ok) return { ok: false, error: guard.error };`
- **Client role resolution**: `lib/currentClient.ts` exports `getCurrentClient()` (returns `null` gracefully) and `requireCurrentClient()` (throws)
- **Defense-in-depth scoping**: even with service-role client, verify `record.client_id === client.id` before returning client-scoped data (see `_lib/queries.ts:74` in booking flow)
- **`force-dynamic` exports**: every server component page that reads live data exports `export const dynamic = "force-dynamic"` at the top
- **Server-action `ActionResult`** discriminated union: `{ ok: true; data: T } | { ok: false; error: string }` — actions never throw
- **Email templates**: inline styles, Google Fonts link, brand hex colors hardcoded, sharp corners, three-section table layout (forest header / cream body / deep footer)
- **Form styles**: import from `app/owner/clients/[id]/_components/formStyles` (fieldStyle, labelStyle, errorStyle, applyFocus, clearFocus)
- **Tab content**: client-detail tabs render placeholder panels inline; `PlaceholderPanel` is a local component in `app/owner/clients/[id]/page.tsx`
- **Sidebar nav**: items are `{ label, href }` objects in the layout file; active state via `usePathname` matching

---

## 15. Conventions and gotchas

- **No RLS**: all security is enforced in app code. Service-role Supabase client is used everywhere. Every read/write must verify role + scope explicitly.
- **TZ handling**: messages use the browser-locale `toLocaleString` pattern (like `created_at` elsewhere), NOT the wall-clock `America/Chicago` kit (which is for calendar/booking events anchored to specific local times).
- **Owner identity**: there is no `owner_id` column on messages — `sender_role = 'owner'` implies Kelsey (the single owner). Client identity comes from `client_id`. If multi-owner support is ever added, the schema will need a sender_id column.
- **`force-dynamic`**: must be on every Messages page (`/owner/messages`, `/client/messages`) since they read live data.
- **`revalidatePath`** after writes: less critical for Messages since polling handles freshness, but still call `revalidatePath` for the affected pages in case a user navigates rather than waits for the poll.
- **Don't add a fourth `ensureOwner` copy**: shoots actions still has a local copy (flagged for cleanup); Messages must use `lib/auth.ts`.
- **Resend env vars**: `RESEND_API_KEY` (required) and `RESEND_FROM_EMAIL` (optional, defaults to `Digital Bloom Socials <onboarding@resend.dev>`).
- **Vercel Cron env var**: `CRON_SECRET` for authenticating the daily reminder endpoint. Add to Vercel project env vars before deploying the cron route.

---

*End of spec. Use this document as the source of truth for all Messages feature implementation prompts.*