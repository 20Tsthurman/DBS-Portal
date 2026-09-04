-- 020_shoot_declined.sql
-- Book a Shoot: a declined request becomes its own outcome, visible to the
-- client who asked for it.
--
-- THE BUG THIS FIXES. Kelsey's "Decline" button on a pending request wrote
-- status = 'cancelled' — the same value the client's own "Cancel request"
-- button writes. The client booking page hides cancelled shoots (they were
-- assumed to be self-cancellations, where a struck-through pill is just
-- noise), so a declined request silently disappeared from the client's
-- calendar. Kelsey saw "cancelled"; the client saw nothing at all and had no
-- way to tell a decline from a request that never went through.
--
-- 'declined' is therefore not cosmetic. It is the one bit that says WHO ended
-- the request, which is exactly the bit the client page needs to decide
-- between hiding a row and explaining it.
--
-- PURELY ADDITIVE: one widened CHECK, two new nullable columns, one new
-- CHECK. No table created or dropped, no existing column modified, no data
-- written. Safe to run top-to-bottom in the Supabase SQL Editor, and safe to
-- re-run.
--
-- Conventions match 001 and 015-019: text + CHECK (no PG enums), no triggers
-- and no functions, DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT idempotency,
-- ADD COLUMN IF NOT EXISTS. RLS on `shoots` is unchanged (the portal reads
-- and writes it through the service client, gated in the server actions).
--
-- NOT BACKFILLED. Rows already sitting at 'cancelled' stay there. There is no
-- stored evidence of who cancelled them, so any backfill would be a guess,
-- and guessing wrong tells a client Kelsey turned them down when they had
-- cancelled it themselves. Past declines stay invisible; every decline from
-- this migration forward is recorded.

-- ----------------------------------------------------------------------------
-- shoots.status — widen to admit 'declined'.
--
-- 'declined' means: the client requested this slot and Kelsey said no. It is
-- terminal, like 'cancelled', and it is treated as cancelled everywhere the
-- distinction does not matter — it never lands on the Google mirror (the push
-- rule in lib/google/push.ts only materialises 'confirmed' and 'completed'),
-- it renders struck-through on both calendars, and it is excluded from every
-- "upcoming" query. The one place it differs is the client's booking page,
-- which shows it and says who ended it.
--
-- Only a shoot at 'requested' can be declined; that transition is enforced in
-- declineShootRequest (app/owner/shoots/_actions.ts), not here, because the
-- table stores no previous status to check against.
-- ----------------------------------------------------------------------------
alter table shoots drop constraint if exists shoots_status_check;
alter table shoots add constraint shoots_status_check
  check (status in ('requested', 'confirmed', 'completed', 'cancelled', 'declined'));

-- ----------------------------------------------------------------------------
-- shoots.decline_reason — Kelsey's optional note to the client, shown on the
-- client's booking page beside the declined request ("that morning is booked
-- — Thursday is open").
--
-- Nullable because it is optional: declining with no note is a valid answer,
-- and forcing a reason would only produce empty ones. Plain text, no length
-- cap in the schema — the action caps it at 500 characters, which is the
-- limit the UI advertises, and a cap here would only turn a too-long note
-- into a 500 error instead of a validation message.
--
-- shoots.declined_at — when the decline happened. Distinct from created_at
-- (when the client asked) and needed on its own because the client page's
-- decline notice is time-boxed: a request Kelsey turned down two months ago
-- for a date that has since passed should stop shouting. scheduled_at cannot
-- stand in for it — Kelsey may decline a request the day it comes in for a
-- date three months out.
-- ----------------------------------------------------------------------------
alter table shoots add column if not exists decline_reason text;
alter table shoots add column if not exists declined_at    timestamptz;

-- ----------------------------------------------------------------------------
-- Both decline columns belong to 'declined' rows and nowhere else, the same
-- shape as 001's shoots_meeting_type_only_for_meetings.
--
-- The constraint's real job is the REVERSE transition. Kelsey can move a
-- shoot off 'declined' from the edit form (declined -> requested, say, if she
-- changes her mind), and a stale reason left behind on a confirmed shoot
-- would surface in the client's panel as a note contradicting the booking.
-- updateShoot clears both columns whenever status moves away from 'declined';
-- this CHECK is what guarantees no other writer can skip that step.
-- ----------------------------------------------------------------------------
alter table shoots drop constraint if exists shoots_decline_fields_only_when_declined;
alter table shoots add constraint shoots_decline_fields_only_when_declined
  check (status = 'declined' or (decline_reason is null and declined_at is null));

-- No new index. Every read of these columns is already client-scoped
-- (shoots_client_id_idx) or by primary key; the client's decline notice
-- filters an already-tiny per-client result set in Postgres, not a table scan.
