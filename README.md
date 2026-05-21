# DBS Portal

Digital Bloom Socials — invite-only client portal. See `dbs-portal-blueprint-v1.md` for the full spec.

## Stack

Next.js 15 (App Router), TypeScript, Clerk (auth), Supabase (Postgres + Storage), Tailwind, Resend (email).

## Local development

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

App runs at `http://localhost:3000`.

## Auth flow

The portal is invite-only. End-to-end:

1. Owner invites a client from `/owner/clients`. The server inserts a row in `clients` (with `clerk_user_id = NULL`), creates a Clerk invitation with `publicMetadata = { role: 'client', clientId: <row uuid> }`, and triggers a Resend email containing the invitation magic link.
2. Client clicks the link → lands on `/sign-up?__clerk_ticket=...&__clerk_status=sign_up`.
3. The sign-up page validates the ticket params on the server. Without them, it redirects to `/sign-in?error=invitation_required`. With them, it renders Clerk's `<SignUp />` which auto-locks the email field to the invited address.
4. Client completes signup (Google or password). Clerk consumes the invitation, copying its `publicMetadata` onto the new user.
5. Clerk fires a `user.created` webhook → handler reads `publicMetadata.clientId` and writes `clerk_user_id` to that Supabase row.
6. Browser redirects to `/finalizing` — a small interstitial that polls `user.reload()` every 500ms until `publicMetadata.role` is present in the JWT, then routes to `/client/dashboard` or `/owner/dashboard`. After 15s of polling with no role, it falls back to a "something's taking longer than expected" message with a Reload button.

> Why the interstitial: Clerk's session refresh is asynchronous, so on the very first request after signup, `sessionClaims.publicMetadata.role` is often empty for ~1–3 seconds. Without `/finalizing`, post-signup users would land on a blank page until they manually reloaded. `app/page.tsx` is still the canonical role-router for **already**-signed-in users (e.g., direct visits to `/`).

## Database

The schema is a single consolidated migration:
`supabase/migrations/001_initial_schema.sql`. It is idempotent — running it
top-to-bottom against an empty Postgres database reproduces the full schema,
and re-running it against an already-migrated database is a safe no-op.

To provision a database, run these in the Supabase SQL Editor, in order:

1. `supabase/migrations/001_initial_schema.sql` — schema: all tables,
   constraints, indexes, the `client-files` Storage bucket, and the
   `app_settings` singleton row.
2. `supabase/seed.sql` — the three package tiers. One-shot; **not** idempotent.
3. `supabase/seed-financials.sql` — Kelsey's Q1–Q2 2026 financial backfill.
   One-shot; **not** idempotent.

The pre-consolidation files (the old `schema.sql` and migrations `001`–`003`)
are kept under `supabase/migrations/_archive/` for history only — do not run
them.

## Local webhook development

The Clerk auth flow relies on a webhook (`POST /api/webhooks/clerk`). To test it locally, use the Svix CLI to expose your dev server with a public URL.

### One-time setup

1. Start the app:

   ```bash
   npm run dev
   ```

2. In a second terminal, start the webhook tunnel:

   ```bash
   npm run dev:webhook
   ```

   It prints a public URL like `https://play.svix.com/in/c_XXXXXXXX/`. Any POST to that URL is forwarded to `http://localhost:3000/api/webhooks/clerk`.

3. In the [Clerk dashboard](https://dashboard.clerk.com/), go to **Webhooks → Add Endpoint**:
   - **Endpoint URL**: paste the Svix Play URL from step 2.
   - **Subscribe to events**: `user.created`, `user.updated`, `user.deleted`.
   - Save.

4. On the new endpoint's settings page, copy the **Signing Secret** (starts with `whsec_…`) and add it to `.env.local`:

   ```
   CLERK_WEBHOOK_SECRET=whsec_...
   ```

5. Restart `npm run dev` so Next.js loads the new env var.

### What the webhook does

The webhook is the single source of truth for linking a Clerk user to a Supabase `clients` row. The end-to-end flow:

1. Owner invites a client → row inserted with `clerk_user_id = NULL`, Clerk invitation created with `publicMetadata = { role: 'client', clientId: <new row's uuid> }`.
2. Client signs up via the invitation → Clerk auto-copies the invitation's `publicMetadata` onto the new user and fires a `user.created` webhook.
3. Webhook reads `publicMetadata.clientId`, writes the new Clerk user id to `clients.clerk_user_id` for that row.
4. Subsequent dashboard queries can find the client by `clerk_user_id`.

> **Why `publicMetadata` and not `privateMetadata`?** Clerk's invitation API only accepts `publicMetadata` (verified against `@clerk/backend` types). `clientId` is a UUID, not a secret, so exposing it in JWT claims is safe — the security boundary is server-side authorization, not metadata visibility.

Skipped paths (all return `200`, none are errors):
- No role and no `clientId` on the new user → likely Kelsey's own owner signup or a manual Clerk dashboard creation. Logged as `skipped`.
- `role=client` but no `clientId` → a regression in the invite route; logged loudly as `skipped_no_client_id`.
- The Clerk user already has `role=owner` → refuses to overwrite, logged as `skipped_owner_role`.
- `clientId` doesn't match any row → logged as `no_match`.

Only DB-layer failures return `5xx`, which causes Svix to retry.

### Notes

- The Svix Play URL is ephemeral — each time you restart `npm run dev:webhook` you'll get a new URL and need to update the Clerk dashboard endpoint.
- The webhook endpoint verifies every request's `svix-signature` header against `CLERK_WEBHOOK_SECRET`. Requests without a valid signature get a `400`.

### Using the dev test script

`scripts/test-webhook.mjs` signs and POSTs synthetic `user.created` payloads directly to the local endpoint. Useful for fast iteration on edge cases without going through a real invite/signup. Dev-only — do not run in production.

```bash
# Get help
npm run test:webhook -- --help

# Verify a real link (look up an existing clients.id from Supabase first)
npm run test:webhook -- linked --client-id=<uuid>

# Verify idempotency (same user-id + client-id, re-fired)
npm run test:webhook -- linked --client-id=<uuid> --user-id=user_test_keep
npm run test:webhook -- already_linked --client-id=<uuid> --user-id=user_test_keep

# Verify the no-clientId skip path
npm run test:webhook -- no_client_id

# Verify a clientId pointing nowhere
npm run test:webhook -- no_match

# Verify the "owner or manual signup" no-op path
npm run test:webhook -- skipped
```

The script uses Node's `--env-file=.env.local` so `CLERK_WEBHOOK_SECRET` resolves automatically. The dev server (`npm run dev`) must be running.

### Verifying the webhook

1. With both terminals running, the tunnel terminal should show a public URL.
2. POST to `http://localhost:3000/api/webhooks/clerk` directly with no signature → expect `400 { error: "Missing svix signature headers" }`.
3. In the Clerk dashboard, create a test user (or update one). The dev server console should log a line like `[clerk webhook] user.created { id, emails, public_metadata, private_metadata }`.
4. The Clerk dashboard's **Webhooks → your endpoint → Message Attempts** should show a `2xx` delivery.
