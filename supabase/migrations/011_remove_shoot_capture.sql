-- 011_remove_shoot_capture.sql
-- Stage 2 (Confirm Shoots capture queue) is removed: the portal no longer
-- reacts to Google event titles. Business shoots are born in the portal and
-- push OUT (Stage 3); Google events flow IN only as read-only busy blocks.
--
-- This drops the Stage-2 schema that 010 added. Runs against LIVE data that
-- holds candidate state (pending/dismissed rows + one converted row), so
-- ORDER MATTERS and is deliberate:
--
--   1. DELETE the converted candidate's row FIRST. Its shoot row is the
--      surviving record (it renders and blocks bookings); once
--      converted_shoot_id is gone nothing would exclude the event row, and
--      it would double-render/double-block next to its own shoot.
--   2. Then drop index → constraint → columns.
--
-- What happens to the other rows: pending/dismissed candidates simply lose
-- the shoot_candidate value and remain ordinary imported busy events —
-- exactly the target model. No other row is deleted.
--
-- Idempotent: every statement is IF EXISTS-guarded or (the DELETE) matches
-- zero rows on a re-run because the column is gone... which would error —
-- so the DELETE is wrapped to run only while the column still exists.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'external_events' and column_name = 'converted_shoot_id'
  ) then
    delete from external_events where converted_shoot_id is not null;
  end if;
end $$;

drop index if exists external_events_shoot_candidate_idx;
alter table external_events drop constraint if exists external_events_shoot_candidate_check;
alter table external_events drop column if exists shoot_candidate;
alter table external_events drop column if exists converted_shoot_id;
alter table external_events drop column if exists location;
