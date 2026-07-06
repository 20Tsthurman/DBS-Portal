import { google, type Auth, type calendar_v3 } from "googleapis";

/**
 * Thin wrapper around the Google Calendar v3 events API.
 *
 * Stage 1 only reads (listEventsIncremental). The write/watch surface is
 * stubbed so Stages 2–3 have a stable module to fill in, and so the sync
 * module's imports don't churn.
 */

export type GoogleEvent = calendar_v3.Schema$Event;

/** How far back the initial full sync reaches. Future events are unbounded. */
export const INITIAL_SYNC_PAST_DAYS = 30;

export function getCalendarApi(auth: Auth.OAuth2Client): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth });
}

export interface ListEventsResult {
  items: GoogleEvent[];
  nextSyncToken: string;
  /** True when a stored sync token was rejected (HTTP 410) and we re-fetched the full window. */
  fullResyncPerformed: boolean;
}

function isGoneError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number | string }).code === 410
  );
}

/**
 * List changed events since `syncToken`, or the full window when no token is
 * held. Pages through all results (the nextSyncToken only arrives on the
 * last page).
 *
 * Parameter constraints (Google API rules, not choices):
 *   - `singleEvents: true` expands recurring events into instances, each with
 *     its own stable id — required for per-row upserts.
 *   - `showDeleted: true` is mandatory alongside a syncToken; cancelled
 *     events arrive as status:'cancelled' tombstones.
 *   - `timeMin` and `orderBy` are FORBIDDEN alongside a syncToken, so the
 *     window bound only applies to the initial full fetch and results are
 *     unordered (the portal sorts after mapping anyway).
 *
 * A 410 GONE means the sync token expired server-side; per the API contract
 * we drop it and re-fetch the full window.
 */
export async function listEventsIncremental(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  syncToken: string | null
): Promise<ListEventsResult> {
  if (syncToken) {
    try {
      const { items, nextSyncToken } = await listAllPages(calendar, {
        calendarId,
        singleEvents: true,
        showDeleted: true,
        syncToken,
      });
      return { items, nextSyncToken, fullResyncPerformed: false };
    } catch (err) {
      if (!isGoneError(err)) throw err;
      // Fall through to a full fetch with no token.
    }
  }

  const timeMin = new Date(
    Date.now() - INITIAL_SYNC_PAST_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { items, nextSyncToken } = await listAllPages(calendar, {
    calendarId,
    singleEvents: true,
    showDeleted: true,
    timeMin,
  });
  return {
    items,
    nextSyncToken,
    fullResyncPerformed: syncToken !== null,
  };
}

async function listAllPages(
  calendar: calendar_v3.Calendar,
  params: calendar_v3.Params$Resource$Events$List
): Promise<{ items: GoogleEvent[]; nextSyncToken: string }> {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null | undefined;

  do {
    const res = await calendar.events.list({
      ...params,
      maxResults: 250,
      pageToken,
    });
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
    nextSyncToken = res.data.nextSyncToken;
  } while (pageToken);

  if (!nextSyncToken) {
    throw new Error(
      "Google events.list returned no nextSyncToken on the final page"
    );
  }
  return { items, nextSyncToken };
}

// ---------------------------------------------------------------------------
// Stage 2/3 stubs — Portal → Google writes and push-notification channels.
// Deliberately unimplemented so a stray Stage 1 code path can't write to
// Kelsey's calendar.
// ---------------------------------------------------------------------------

export async function insertEvent(): Promise<never> {
  throw new Error("insertEvent is not implemented until Stage 3 (write scope)");
}

export async function patchEvent(): Promise<never> {
  throw new Error("patchEvent is not implemented until Stage 3 (write scope)");
}

export async function deleteEvent(): Promise<never> {
  throw new Error("deleteEvent is not implemented until Stage 3 (write scope)");
}

export async function watchEvents(): Promise<never> {
  throw new Error("watchEvents is not implemented until Stage 3 (push channels)");
}
