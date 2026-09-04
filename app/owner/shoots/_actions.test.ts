import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the three defects the 020 audit turned up, and nothing else. All three
 * are the same species of bug: a decline is the ONE status that carries extra
 * columns (`declined_at`, `decline_reason`) under a CHECK, and every path that
 * writes `status` without minding them is a way to desync the pair.
 *
 * Nothing here talks to Postgres. A recording fake stands in for supabase-js
 * and plays back scripted results, one per `from()` call, in the order the
 * action issues them — the same fake shape `cycleLock.test.ts` uses. The
 * actions reach for the client through `getSupabaseServiceClient()` rather
 * than taking it as an argument, so the module is mocked to hand back the
 * fake; auth, Google push, and `revalidatePath` are stubbed for the same
 * reason (they are not what these tests are about).
 */

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface Call {
  method: string;
  args: unknown[];
}

interface RecordedQuery {
  table: string;
  calls: Call[];
}

const BUILDER_METHODS = [
  "select",
  "insert",
  "update",
  "delete",
  "eq",
  "single",
  "maybeSingle",
] as const;

function fakeSupabase(script: QueryResult[]) {
  const queries: RecordedQuery[] = [];
  let next = 0;
  const client = {
    from(table: string) {
      const recorded: RecordedQuery = { table, calls: [] };
      queries.push(recorded);
      const result = script[next++] ?? {
        data: null,
        error: { message: "unscripted query" },
      };
      const builder: Record<string, unknown> = {
        then(
          resolve: (value: QueryResult) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      for (const method of BUILDER_METHODS) {
        builder[method] = (...args: unknown[]) => {
          recorded.calls.push({ method, args });
          return builder;
        };
      }
      return builder;
    },
  };
  return { client, queries };
}

function call(query: RecordedQuery, method: string): Call | undefined {
  return query.calls.find((c) => c.method === method);
}

/** Set per test, before the action runs. */
let queries: RecordedQuery[] = [];

const getSupabaseServiceClient = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabaseServiceClient: () => getSupabaseServiceClient(),
}));
vi.mock("@/lib/auth", () => ({
  requireOwner: async () => ({ ok: true, ownerLabel: "Kelsey" }),
}));
vi.mock("@/lib/google/push", () => ({
  syncShootToGoogleNonFatal: async () => undefined,
  deleteGoogleEventNonFatal: async () => undefined,
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const { createShoot, declineShootRequest, updateShoot } = await import(
  "./_actions"
);

const SHOOT_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";

/** Verbatim copy under test — a reworded string is a behaviour change. */
const STALE_MESSAGE =
  "This request was already answered. Refresh to see where it stands.";
const CREATE_MESSAGE =
  "A shoot can't be created as declined. Decline a client's request from the pending requests list instead.";

/** What the pre-write SELECT in `updateShoot` reads back. */
const currentRow = (status: string): QueryResult => ({
  data: { kind: "shoot", meeting_type: null, status },
  error: null,
});

/** Any successful write result — these tests assert on the patch, not the row. */
const writtenRow: QueryResult = {
  data: {
    id: SHOOT_ID,
    client_id: CLIENT_ID,
    project_id: null,
    scheduled_at: "2026-10-02T15:00:00+00:00",
    location: null,
    duration_hours: null,
    status: "confirmed",
    notes: null,
    kind: "shoot",
    meeting_type: null,
    created_at: "2026-09-01T00:00:00+00:00",
    decline_reason: null,
    declined_at: null,
    google_event_id: null,
    google_calendar_id: null,
    google_sync_pending: false,
  },
  error: null,
};

function script(...results: QueryResult[]): void {
  const fake = fakeSupabase(results);
  queries = fake.queries;
  getSupabaseServiceClient.mockReturnValue(fake.client);
}

beforeEach(() => {
  queries = [];
  getSupabaseServiceClient.mockReset();
});

describe("updateShoot decline columns", () => {
  it("clears both decline columns when moving off 'declined'", async () => {
    script(currentRow("declined"), writtenRow);

    const result = await updateShoot(SHOOT_ID, { status: "confirmed" });

    expect(result.ok).toBe(true);
    expect(call(queries[1], "update")?.args).toEqual([
      { status: "confirmed", declined_at: null, decline_reason: null },
    ]);
  });

  it("clears both decline columns even when the SELECT said 'requested'", async () => {
    // The TOCTOU case, and the whole reason the clear is unconditional. The
    // row was 'requested' when we read it; by the time the UPDATE lands it
    // could be 'declined' with a note attached. Writing 'confirmed' without
    // the nulls would leave that note under a confirmed booking — or, once
    // 020's CHECK sees the mismatch, fail the save outright.
    script(currentRow("requested"), writtenRow);

    const result = await updateShoot(SHOOT_ID, { status: "confirmed" });

    expect(result.ok).toBe(true);
    expect(call(queries[1], "update")?.args).toEqual([
      { status: "confirmed", declined_at: null, decline_reason: null },
    ]);
  });
});

describe("declineShootRequest", () => {
  it("reports a lost race in Kelsey's words, not PostgREST's", async () => {
    // The guarded UPDATE matched nothing: someone answered this request
    // between the read and the write. With `.single()` that arrived as a
    // PostgREST error string; `.maybeSingle()` makes it data null / error
    // null, which is a state this action has a sentence for.
    script({ data: { status: "requested" }, error: null }, {
      data: null,
      error: null,
    });

    const result = await declineShootRequest(SHOOT_ID, "Booked that weekend.");

    expect(result).toEqual({ ok: false, error: STALE_MESSAGE });
    expect(call(queries[1], "maybeSingle")).toBeDefined();
    expect(call(queries[1], "single")).toBeUndefined();
  });
});

describe("createShoot", () => {
  it("refuses to create a shoot already declined, without touching the table", async () => {
    script();

    const result = await createShoot({
      clientId: CLIENT_ID,
      scheduledAt: "2026-10-02T15:00:00+00:00",
      status: "declined",
    });

    expect(result).toEqual({ ok: false, error: CREATE_MESSAGE });
    expect(queries).toEqual([]);
    expect(getSupabaseServiceClient).not.toHaveBeenCalled();
  });
});
