import type { CalendarEvent } from "./types";

export interface EventLane {
  eventId: string;
  laneIndex: number;
  laneCount: number;
}

/**
 * Assign each event in `events` to a lane (column-fragment) such that no two
 * events sharing the same lane overlap in time. The returned map keys each
 * event by `event.id` and reports its lane index plus the total lane count
 * for its overlap cluster.
 *
 * - Boundary-touching events do NOT overlap: an event ending at 10:00 and one
 *   starting at 10:00 stay in lane 0 with `laneCount = 1` each.
 * - All events inside a connected overlap cluster share the same `laneCount`,
 *   so adjacent chips render at equal width.
 * - Events with no overlaps come back as `{ laneIndex: 0, laneCount: 1 }`.
 */
export function assignEventLanes(
  events: CalendarEvent[]
): Map<string, EventLane> {
  const result = new Map<string, EventLane>();
  if (events.length === 0) return result;

  const sorted = [...events].sort((a, b) => {
    const sd = a.startsAt.getTime() - b.startsAt.getTime();
    if (sd !== 0) return sd;
    return b.endsAt.getTime() - a.endsAt.getTime();
  });

  // Greedy lane assignment: for each event, find the smallest non-negative
  // lane index not already used by an earlier event whose clock time strictly
  // overlaps the current event's start.
  const laneById = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const used = new Set<number>();
    for (let j = 0; j < i; j++) {
      const earlier = sorted[j];
      if (earlier.endsAt.getTime() > current.startsAt.getTime()) {
        const lane = laneById.get(earlier.id);
        if (lane !== undefined) used.add(lane);
      }
    }
    let lane = 0;
    while (used.has(lane)) lane++;
    laneById.set(current.id, lane);
  }

  // Cluster connectivity via union-find. Two events join the same cluster
  // when they directly overlap; transitively-connected events end up sharing
  // the same lane count.
  const parent = new Map<string, string>();
  for (const e of sorted) parent.set(e.id, e.id);
  const find = (id: string): string => {
    let p = id;
    while (parent.get(p) !== p) {
      const next = parent.get(p);
      if (next === undefined) break;
      parent.set(p, parent.get(next) ?? next);
      p = next;
    }
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      // Sorted by start ascending; once b starts at or after a ends, every
      // later event will also fail to overlap a, so we can stop.
      if (b.startsAt.getTime() >= a.endsAt.getTime()) break;
      // Strict overlap (not boundary touch).
      if (
        a.endsAt.getTime() > b.startsAt.getTime() &&
        b.endsAt.getTime() > a.startsAt.getTime()
      ) {
        union(a.id, b.id);
      }
    }
  }

  // Max lane within each cluster → that cluster's lane count.
  const maxLaneByRoot = new Map<string, number>();
  for (const [id, lane] of laneById) {
    const root = find(id);
    const cur = maxLaneByRoot.get(root);
    if (cur === undefined || lane > cur) {
      maxLaneByRoot.set(root, lane);
    }
  }

  for (const [id, lane] of laneById) {
    const root = find(id);
    const max = maxLaneByRoot.get(root) ?? lane;
    result.set(id, {
      eventId: id,
      laneIndex: lane,
      laneCount: max + 1,
    });
  }

  return result;
}
