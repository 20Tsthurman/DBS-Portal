/**
 * CalendarEvent — the unified shape the owner calendar views consume.
 *
 * Timezone convention
 * -------------------
 * `startsAt` and `endsAt` are JS `Date`s (UTC instants).
 *
 *   - Shoots store full UTC timestamps in `shoots.scheduled_at` and map to
 *     `startsAt` directly.
 *   - Time blocks store wall-clock `date` + `start_time` + `end_time` in
 *     PORTAL_TIMEZONE (America/Chicago). They are assembled into UTC instants
 *     via `combineDateAndTimeInTimezone()` in `./timezone.ts`, NEVER via
 *     `new Date("YYYY-MM-DDTHH:MM")` (which uses server-local time and
 *     silently drifts on a UTC host).
 *
 * `dateKey` is always the PORTAL_TIMEZONE day the event starts on.
 *
 * Views must not import `lib/supabase.ts` row types directly — only this
 * file. That isolation is the point: swap a source table later, only this
 * module's mapper changes.
 */

import type { TimeBlockCategory } from "@/lib/supabase";

export type EventCategory =
  | "shoot"
  | "meeting"
  /** Imported Google Calendar event — read-only; edits happen in Google. */
  | "external"
  | TimeBlockCategory;

export type EventStatus =
  | "requested"
  | "confirmed"
  | "completed"
  | "cancelled"
  /** Time blocks have no status column; they all carry this. */
  | "scheduled";

export interface CalendarEvent {
  /** Stable per-event id with table prefix so shoots and time_blocks don't collide. */
  id: string;
  category: EventCategory;
  /** YYYY-MM-DD in PORTAL_TIMEZONE. Used for day-bucketing in Month/Agenda views. */
  dateKey: string;
  startsAt: Date;
  /** Equals `startsAt` for shoots without a `duration_hours`. */
  endsAt: Date;
  /** Headline text: client name for shoots; label for time_blocks. */
  title: string;
  /** Optional secondary text: shoot location, work-block client name, or null. */
  subtitle: string | null;
  status: EventStatus;
  /** Discriminated source — lets row-action menus call the right CRUD action. */
  source:
    | { kind: "shoot"; shootId: string; clientId: string }
    | { kind: "time_block"; timeBlockId: string; clientId: string | null }
    /**
     * Google Calendar import. No portal CRUD — views render these read-only
     * and link out to Google via htmlLink instead of opening an edit panel.
     * `allDay` lets views label the event "All day" instead of the
     * meaningless midnight-to-midnight time span.
     */
    | {
        kind: "external";
        externalEventId: string;
        htmlLink: string | null;
        allDay: boolean;
      };
}
