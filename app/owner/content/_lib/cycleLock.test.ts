import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CONTENT_AUTO_ACTOR } from "@/lib/supabase";
import { lockCycle, runDeadlineSweep } from "./cycleLock";

/**
 * Pins the idempotency contract of the lock: which rows each write touches,
 * what it stamps, and the order the two writes land in. Nothing here talks
 * to Postgres — a recording fake stands in for supabase-js and plays back
 * scripted results, one per query, in the order the code issues them.
 *
 * Why this is worth a test file when almost nothing else in the repo has
 * one: the conditions on these writes are what make the sweep safe to run
 * twice and safe mid-edit, and a dropped `.eq("status", ...)` would typecheck
 * fine and silently overwrite a client's approval or a denied request.
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
  "update",
  "eq",
  "not",
  "lte",
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
  return { client: client as unknown as SupabaseClient, queries };
}

function call(query: RecordedQuery, method: string): Call | undefined {
  return query.calls.find((c) => c.method === method);
}

function calls(query: RecordedQuery, method: string): Call[] {
  return query.calls.filter((c) => c.method === method);
}

const CYCLE_ID = "11111111-1111-4111-8111-111111111111";
const DEADLINE = "2026-09-26T04:59:00+00:00";
const NOW = new Date("2026-09-26T07:00:00Z");

const flippedRows = (n: number) => ({
  data: Array.from({ length: n }, (_, i) => ({ id: `item-${i}` })),
  error: null,
});
const lockedRow = { data: { id: CYCLE_ID }, error: null };
const noRow = { data: null, error: null };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lockCycle", () => {
  it("flips only in_review posts, stamping the lock instant and 'auto'", async () => {
    const { client, queries } = fakeSupabase([flippedRows(3), lockedRow]);

    const result = await lockCycle(client, {
      cycle: { id: CYCLE_ID },
      lockedAt: DEADLINE,
      lockedBy: "auto",
      deadlineAtOrBefore: NOW.toISOString(),
    });

    expect(result).toEqual({ outcome: "locked", autoApproved: 3 });

    const items = queries[0];
    expect(items.table).toBe("content_items");
    expect(call(items, "update")?.args).toEqual([
      { status: "approved", approved_at: DEADLINE, approved_by: CONTENT_AUTO_ACTOR },
    ]);
    expect(calls(items, "eq").map((c) => c.args)).toEqual([
      ["cycle_id", CYCLE_ID],
      ["status", "in_review"],
    ]);
  });

  it("locks the cycle second, guarded on in_review and the deadline still being past", async () => {
    const { client, queries } = fakeSupabase([flippedRows(0), lockedRow]);
    const nowIso = NOW.toISOString();

    await lockCycle(client, {
      cycle: { id: CYCLE_ID },
      lockedAt: DEADLINE,
      lockedBy: "auto",
      deadlineAtOrBefore: nowIso,
    });

    expect(queries.map((q) => q.table)).toEqual([
      "content_items",
      "content_cycles",
    ]);
    const cycle = queries[1];
    expect(call(cycle, "update")?.args).toEqual([
      { status: "locked", locked_at: DEADLINE, locked_by: "auto" },
    ]);
    expect(calls(cycle, "eq").map((c) => c.args)).toEqual([
      ["id", CYCLE_ID],
      ["status", "in_review"],
    ]);
    expect(call(cycle, "lte")?.args).toEqual(["revision_deadline", nowIso]);
    expect(call(cycle, "maybeSingle")).toBeDefined();
  });

  it("reports raced when the cycle write matches no row, keeping the item count", async () => {
    const { client } = fakeSupabase([flippedRows(2), noRow]);

    const result = await lockCycle(client, {
      cycle: { id: CYCLE_ID },
      lockedAt: DEADLINE,
      lockedBy: "auto",
      deadlineAtOrBefore: NOW.toISOString(),
    });

    expect(result).toEqual({ outcome: "raced", autoApproved: 2 });
  });

  it("never writes the cycle when the item write fails", async () => {
    const { client, queries } = fakeSupabase([
      { data: null, error: { message: "boom" } },
    ]);

    await expect(
      lockCycle(client, {
        cycle: { id: CYCLE_ID },
        lockedAt: DEADLINE,
        lockedBy: "auto",
      })
    ).rejects.toThrow("Failed to auto-approve posts: boom");
    expect(queries.map((q) => q.table)).toEqual(["content_items"]);
  });

  it("Lock now stamps 'owner' with no deadline predicate", async () => {
    const { client, queries } = fakeSupabase([flippedRows(1), lockedRow]);
    const pressedAt = "2026-09-20T18:03:11.000Z";

    await lockCycle(client, {
      cycle: { id: CYCLE_ID },
      lockedAt: pressedAt,
      lockedBy: "owner",
    });

    const cycle = queries[1];
    expect(call(cycle, "update")?.args).toEqual([
      { status: "locked", locked_at: pressedAt, locked_by: "owner" },
    ]);
    expect(call(cycle, "lte")).toBeUndefined();
    // The untouched post is still the deadline's doing, not Kelsey's.
    expect(call(queries[0], "update")?.args).toEqual([
      { status: "approved", approved_at: pressedAt, approved_by: CONTENT_AUTO_ACTOR },
    ]);
  });
});

describe("runDeadlineSweep", () => {
  const dueCycle = (id: string, deadline: string) => ({
    id,
    client_id: "client-1",
    month: "2026-10-01",
    revision_deadline: deadline,
    included_rounds: 1,
    extra_round_price: null,
    billing_mode: "per_round",
    status: "in_review",
    locked_at: null,
    locked_by: null,
    created_at: "2026-09-20T00:00:00+00:00",
  });

  it("selects in_review cycles with a deadline at or before now", async () => {
    const { client, queries } = fakeSupabase([{ data: [], error: null }]);

    const summary = await runDeadlineSweep(client, NOW);

    expect(summary).toEqual({
      cyclesDue: 0,
      cyclesLocked: 0,
      itemsAutoApproved: 0,
      raced: 0,
      errors: 0,
    });
    const read = queries[0];
    expect(read.table).toBe("content_cycles");
    expect(call(read, "eq")?.args).toEqual(["status", "in_review"]);
    expect(call(read, "not")?.args).toEqual(["revision_deadline", "is", null]);
    expect(call(read, "lte")?.args).toEqual([
      "revision_deadline",
      NOW.toISOString(),
    ]);
  });

  it("dates each auto-approval to that cycle's deadline, not the run time", async () => {
    const otherDeadline = "2026-09-25T04:59:00+00:00";
    const { client, queries } = fakeSupabase([
      { data: [dueCycle("cycle-a", DEADLINE), dueCycle("cycle-b", otherDeadline)], error: null },
      flippedRows(3),
      lockedRow,
      flippedRows(1),
      noRow,
    ]);

    const summary = await runDeadlineSweep(client, NOW);

    expect(summary).toEqual({
      cyclesDue: 2,
      cyclesLocked: 1,
      itemsAutoApproved: 4,
      raced: 1,
      errors: 0,
    });
    expect(call(queries[1], "update")?.args[0]).toMatchObject({
      approved_at: DEADLINE,
    });
    expect(call(queries[2], "update")?.args[0]).toMatchObject({
      locked_at: DEADLINE,
      locked_by: "auto",
    });
    expect(call(queries[3], "update")?.args[0]).toMatchObject({
      approved_at: otherDeadline,
    });
    expect(call(queries[4], "update")?.args[0]).toMatchObject({
      locked_at: otherDeadline,
    });
  });

  it("counts a failed cycle and goes on to the next", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, queries } = fakeSupabase([
      { data: [dueCycle("cycle-a", DEADLINE), dueCycle("cycle-b", DEADLINE)], error: null },
      { data: null, error: { message: "boom" } },
      flippedRows(2),
      lockedRow,
    ]);

    const summary = await runDeadlineSweep(client, NOW);

    expect(summary).toEqual({
      cyclesDue: 2,
      cyclesLocked: 1,
      itemsAutoApproved: 2,
      raced: 0,
      errors: 1,
    });
    expect(queries.map((q) => q.table)).toEqual([
      "content_cycles",
      "content_items",
      "content_items",
      "content_cycles",
    ]);
  });
});
