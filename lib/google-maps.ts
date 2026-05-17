/**
 * Google Distance Matrix wrapper. Server-side only — never expose the API
 * key to the browser. Phase 4 uses this from the accept-mileage-suggestion
 * action to compute the trip's mileage from two free-text addresses.
 *
 * No caching layer (per Phase 4 spec). Each call is a fresh HTTP fetch
 * against the Distance Matrix API. If cost or latency becomes a concern,
 * cache at the call site or back this with a Supabase `distance_cache`
 * table later.
 */

const DISTANCE_MATRIX_URL =
  "https://maps.googleapis.com/maps/api/distancematrix/json";

const METERS_PER_MILE = 1609.344;

// Mirrors the requireEnv() pattern from lib/supabase.ts:280-286 (the helper
// there is module-local; duplicating the six lines avoids broadening
// supabase.ts's public surface).
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

interface DistanceMatrixElement {
  status: string;
  distance?: { text: string; value: number };
  duration?: { text: string; value: number };
}
interface DistanceMatrixRow {
  elements: DistanceMatrixElement[];
}
interface DistanceMatrixResponse {
  status: string;
  error_message?: string;
  rows: DistanceMatrixRow[];
}

/**
 * Driving distance in miles between two free-text addresses (geocoded by
 * Google). Rounded to one decimal place.
 *
 * Throws on:
 *   - missing GOOGLE_MAPS_API_KEY
 *   - non-2xx HTTP response
 *   - top-level Distance Matrix status other than `OK`
 *   - per-element status other than `OK` (`ZERO_RESULTS`, `NOT_FOUND`, etc.)
 *   - a missing `distance` payload (shouldn't happen when element.status is `OK`)
 *
 * Callers in server actions should catch and convert to an `ActionResult`
 * error string.
 */
export async function getMilesBetween(
  from: string,
  to: string
): Promise<number> {
  const apiKey = requireEnv("GOOGLE_MAPS_API_KEY");

  const url = new URL(DISTANCE_MATRIX_URL);
  url.searchParams.set("origins", from);
  url.searchParams.set("destinations", to);
  url.searchParams.set("units", "imperial");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Distance Matrix HTTP ${res.status}`);
  }

  const json = (await res.json()) as DistanceMatrixResponse;
  if (json.status !== "OK") {
    const detail = json.error_message ? ` — ${json.error_message}` : "";
    throw new Error(`Distance Matrix API error: ${json.status}${detail}`);
  }

  const element = json.rows[0]?.elements[0];
  if (!element) {
    throw new Error("Distance Matrix returned no elements");
  }
  if (element.status !== "OK") {
    throw new Error(`Distance Matrix element error: ${element.status}`);
  }
  if (!element.distance) {
    throw new Error("Distance Matrix element missing distance payload");
  }

  const miles = element.distance.value / METERS_PER_MILE;
  return Math.round(miles * 10) / 10;
}
