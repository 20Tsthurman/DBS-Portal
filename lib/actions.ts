/**
 * Shared envelope for every server action's return value.
 *
 * Convention: actions never throw to callers — they catch internally and
 * return `{ ok: false, error: "..." }`. Successful writes return
 * `{ ok: true, data }` (when there's a payload) or `{ ok: true }`.
 */
export interface ActionResult<T = null> {
  ok: boolean;
  error?: string;
  data?: T;
}
