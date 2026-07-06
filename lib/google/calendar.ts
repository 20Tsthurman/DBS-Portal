import { google, type Auth, type calendar_v3 } from "googleapis";

/**
 * Thin wrapper around the Google Calendar v3 events API. Reads
 * (listEventsIncremental, listCalendars) serve the Stage 1 import; writes
 * (insertEvent / patchEvent / deleteEvent) serve the Stage 3 push. Watch
 * channels (push notifications) remain stubbed — out of scope.
 */

export type GoogleEvent = calendar_v3.Schema$Event;

/**
 * Echo-loop guard key, shared by the importer and the pusher. Every event
 * the portal pushes carries extendedProperties.private[PORTAL_SOURCE_KEY] =
 * "shoot:<id>", and the importer skips any event carrying the key — so a
 * pushed shoot can never round-trip back in as a busy block. Load-bearing:
 * the push target ("digital bloom") is also an imported calendar.
 */
export const PORTAL_SOURCE_KEY = "dbsPortalSource";

/** How far back the initial full sync reaches. Future events are unbounded. */
export const INITIAL_SYNC_PAST_DAYS = 30;

export function getCalendarApi(auth: Auth.OAuth2Client): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth });
}

export interface GoogleCalendarListEntry {
  /**
   * Canonical portal id: 'primary' for the account's primary calendar
   * (whose raw calendarList id is the email address), the raw id otherwise.
   * Matches the google_synced_calendars.calendar_id convention.
   */
  id: string;
  summary: string;
  primary: boolean;
  /** Google backgroundColor, e.g. "#9fe1e7". */
  color: string | null;
}

/**
 * The account's calendar list (calendarList.list), for the settings
 * checkboxes. Read-only — covered by the calendar.readonly scope.
 */
export async function listCalendars(
  auth: Auth.OAuth2Client
): Promise<GoogleCalendarListEntry[]> {
  const api = getCalendarApi(auth);
  const items: calendar_v3.Schema$CalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const res = await api.calendarList.list({ maxResults: 250, pageToken });
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  const entries: GoogleCalendarListEntry[] = [];
  for (const item of items) {
    if (!item.id) continue;
    entries.push({
      id: item.primary ? "primary" : item.id,
      summary: item.summaryOverride?.trim() || item.summary?.trim() || item.id,
      primary: Boolean(item.primary),
      color: item.backgroundColor ?? null,
    });
  }
  // Primary first, then alphabetical — stable order for the checkbox list.
  entries.sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return a.summary.localeCompare(b.summary);
  });
  return entries;
}

export interface ListEventsResult {
  items: GoogleEvent[];
  nextSyncToken: string;
  /** True when a stored sync token was rejected (HTTP 410) and we re-fetched the full window. */
  fullResyncPerformed: boolean;
}

function errorStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { code?: number | string; response?: { status?: number } };
  if (typeof e.code === "number") return e.code;
  if (typeof e.response?.status === "number") return e.response.status;
  return null;
}

function isGoneError(err: unknown): boolean {
  return errorStatus(err) === 410;
}

/** 404/410 — the event no longer exists (or never did) on Google's side. */
export function isMissingEventError(err: unknown): boolean {
  const status = errorStatus(err);
  return status === 404 || status === 410;
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
// Stage 3 writes — Portal → Google push.
// ---------------------------------------------------------------------------

/** Insert an event; returns Google's event id. */
export async function insertEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  event: calendar_v3.Schema$Event
): Promise<string> {
  const res = await calendar.events.insert({ calendarId, requestBody: event });
  if (!res.data.id) {
    throw new Error("Google events.insert returned no event id");
  }
  return res.data.id;
}

/** Patch an existing event. Throws (incl. isMissingEventError cases) — callers decide. */
export async function patchEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
  event: calendar_v3.Schema$Event
): Promise<void> {
  await calendar.events.patch({ calendarId, eventId, requestBody: event });
}

/** Delete an event. Already-gone (404/410) counts as success. */
export async function deleteEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string
): Promise<void> {
  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (err) {
    if (isMissingEventError(err)) return;
    throw err;
  }
}

/** Push-notification channels — out of scope; sync is cron + on-view. */
export async function watchEvents(): Promise<never> {
  throw new Error("watchEvents is not implemented (push channels are out of scope)");
}
