import { createSign } from "node:crypto";

/**
 * Cloudflare Stream wrapper. Server-side only — CLOUDFLARE_STREAM_TOKEN is a
 * Stream:Edit-scoped account token and must never reach the browser. Phase 2B
 * uses this module for the review-video path described in spec §3.5/§3.6:
 * mint a Direct Creator Upload URL, watch the video become playable, mint a
 * short-lived playback token, and delete a superseded video.
 *
 * Module posture mirrors lib/storage.ts: every function throws on failure and
 * returns only success values. Callers wrap in their own try/catch and convert
 * to an `ActionResult`. Nothing here returns an error object, logs, or retries.
 *
 * Postgres is the source of truth (spec §3.1). Stream holds bytes and nothing
 * else — no query in this module is a substitute for reading `content_assets`.
 *
 * NOT read here: CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN. A playback token is
 * only half a playback URL; the other half is the customer subdomain, and the
 * URL is assembled by the playback surface in slice 2.4, not by this module.
 * The shape it needs is recorded on `createPlaybackToken` below.
 */

const STREAM_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Maximum duration, in seconds, that a Direct Creator Upload link will accept.
 *
 * This is not just a validation limit. Cloudflare DEDUCTS the reserved
 * duration from the account's available storage the moment the link is minted
 * and holds it until the upload is received, errors, or the link expires — the
 * unused remainder is released only then. A generous cap would let a handful
 * of stalled or abandoned uploads reserve a meaningful slice of the single
 * prepaid 1,000-minute block the cost model in spec §3.3 budgets for, and
 * §3.7 says stalled uploads are the normal case on iPhone/Safari rather than
 * the exception. Spec §3.5d fixes this tight at 120s; review clips run 6–15s,
 * so there is already ~10x headroom.
 *
 * A video that exceeds this does NOT fail at upload time — the POST succeeds
 * and the video lands in `status.state === "error"` with
 * `errorReasonCode: "ERR_DURATION_EXCEED_CONSTRAINT"` during processing. That
 * surfaces through `getVideoStatus` as `"failed"`, not as a thrown upload.
 */
const MAX_UPLOAD_DURATION_SECONDS = 120;

/**
 * Lifetime of a minted playback token.
 *
 * Cloudflare caps `exp` at 24 hours past signing time and defaults its own
 * `/token` endpoint to one hour. One hour is chosen here because:
 *   - it matches DOWNLOAD_URL_TTL_SECONDS in lib/storage.ts, so both media
 *     paths in the portal expire on the same clock;
 *   - the token is embedded in the manifest URL and is re-checked while the
 *     video plays, so it must outlive a whole review session — a client
 *     working down the queue must never hit a mid-playback expiry;
 *   - it is still short enough that a URL copied out of the page is dead well
 *     before it could be usefully shared, which is the §3.5a requirement.
 */
const PLAYBACK_TOKEN_TTL_SECONDS = 3600;

// Mirrors the requireEnv() pattern from lib/google-maps.ts:20-26 and
// lib/supabase.ts:280-286 (the helper there is module-local; duplicating the
// six lines avoids broadening another module's public surface).
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Every Cloudflare v4 response carries this envelope, including 2xx responses
 * that report an in-band failure via `success: false`. Checking `res.ok` alone
 * is not enough — same trap as the Distance Matrix `status` field in
 * lib/google-maps.ts.
 */
interface StreamEnvelope<T> {
  result: T | null;
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: unknown[];
}

/**
 * The subset of Cloudflare's `Video` object this module reads. Their payload
 * is much wider (captions, watermark, publicDetails, playback manifests); we
 * deliberately type only what `content_assets` needs so an unrelated vendor
 * field appearing or vanishing cannot break a parse.
 */
interface StreamVideo {
  uid?: string;
  readyToStream?: boolean;
  duration?: number;
  size?: number;
  input?: { width?: number; height?: number };
  status?: {
    state?: string;
    pctComplete?: string;
    // Cloudflare's own docs are inconsistent about these key names: the video
    // object and their SDK use errorReason*, while the error example on the
    // webhooks page uses errReason*. Both are read below rather than betting
    // on one.
    errorReasonCode?: string;
    errorReasonText?: string;
    errReasonCode?: string;
    errReasonText?: string;
  };
}

function accountStreamUrl(path: string): string {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  return `${STREAM_API_BASE}/accounts/${accountId}/stream${path}`;
}

/** Flatten Cloudflare's `errors` array into a message suffix, if present. */
function describeErrors(envelope: StreamEnvelope<unknown> | null): string {
  const errors = envelope?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return "";
  const parts = errors.map(
    (err) => `[${err?.code ?? "?"}] ${err?.message ?? "unknown error"}`
  );
  return ` — ${parts.join("; ")}`;
}

/**
 * One authenticated call against the Stream API, with the two-stage failure
 * check every Cloudflare endpoint needs (HTTP status, then in-band `success`).
 *
 * Returns `result`, which is legitimately `null` for endpoints that carry no
 * payload — DELETE returns either an empty body or an envelope with a null
 * result depending on the endpoint, and both are treated as success here.
 *
 * `cache: "no-store"` because Next would otherwise cache these GETs; a cached
 * `readyToStream: false` would strand an asset in `processing` forever.
 */
async function callStreamApi<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown
): Promise<T | null> {
  const apiToken = requireEnv("CLOUDFLARE_STREAM_TOKEN");

  const res = await fetch(accountStreamUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  const raw = await res.text();
  let envelope: StreamEnvelope<T> | null = null;
  if (raw.trim().length > 0) {
    try {
      envelope = JSON.parse(raw) as StreamEnvelope<T>;
    } catch {
      // Non-JSON body (a proxy error page, an empty 204). Left null so the
      // status check below reports the raw HTTP failure rather than a
      // misleading parse error.
      envelope = null;
    }
  }

  if (!res.ok) {
    throw new Error(
      `Cloudflare Stream ${method} ${path} failed: HTTP ${res.status}${describeErrors(envelope)}`
    );
  }
  if (envelope && envelope.success !== true) {
    throw new Error(
      `Cloudflare Stream ${method} ${path} reported failure${describeErrors(envelope)}`
    );
  }

  return envelope ? envelope.result : null;
}

export interface StreamDirectUpload {
  /** One-time URL the browser uploads to. Never proxied through our server. */
  uploadUrl: string;
  /** The Stream video UID. Store this on `content_assets.external_id`. */
  uid: string;
}

/**
 * Mint a one-time Direct Creator Upload URL and reserve the video's UID.
 *
 * Vercel's ~4.5 MB serverless body limit makes proxying video through an API
 * route impossible (spec §3.6), so the browser uploads straight to Cloudflare.
 * Structurally this is `createSignedUploadUrl` in lib/storage.ts with a
 * different vendor behind it.
 *
 * `requireSignedURLs: true` is set at mint time and is not optional: spec
 * §3.5a requires it on EVERY video, and setting it here means a video is
 * never briefly public between upload and a follow-up PATCH. Once set, the
 * video is unreachable without a token from `createPlaybackToken`.
 *
 * Two vendor constraints the caller must know about:
 *   - The returned `uploadUrl` accepts exactly one `POST multipart/form-data`
 *     of at most 200 MB. It is NOT a tus endpoint. The resumable path in
 *     slice 2.3 is a different Cloudflare call (`POST /stream?direct_user=true`
 *     with `Tus-Resumable`/`Upload-Length`/`Upload-Metadata` headers, upload
 *     URL returned in the `Location` response header), so it needs its own
 *     function rather than an argument here.
 *   - No `expiry` is sent, so Cloudflare applies its default link lifetime
 *     (observed as 24h via the `uploadExpiry` field). With a 120s reservation
 *     an abandoned link holds 0.2% of the 1,000-minute block for a day, which
 *     the §3.3 cost model absorbs. Cloudflare accepts a tighter `expiry`, but
 *     the permitted range is not stated in their docs — do not add one without
 *     verifying the bounds against a live account first.
 *
 * The UID is returned before a single byte is uploaded. It is only meaningful
 * once the upload completes; `getVideoStatus` is what tells you it did.
 *
 * Throws on missing env, non-2xx, `success: false`, or a result that omits
 * either field.
 */
export async function createDirectUploadUrl(): Promise<StreamDirectUpload> {
  const result = await callStreamApi<{ uploadURL?: string; uid?: string }>(
    "/direct_upload",
    "POST",
    {
      maxDurationSeconds: MAX_UPLOAD_DURATION_SECONDS,
      requireSignedURLs: true,
    }
  );

  if (!result?.uploadURL || !result.uid) {
    throw new Error(
      "Cloudflare Stream direct upload returned no uploadURL or uid"
    );
  }

  return { uploadUrl: result.uploadURL, uid: result.uid };
}

/**
 * Maps 1:1 onto the `content_assets.status` CHECK constraint from migration
 * 015. Deliberately narrower than Cloudflare's seven-value `status.state` so
 * callers never have to interpret vendor vocabulary at the call site.
 */
export type StreamAssetStatus = "processing" | "ready" | "failed";

export interface StreamVideoStatus {
  uid: string;
  /** Write straight to `content_assets.status`. */
  status: StreamAssetStatus;
  /** Cloudflare's raw `status.state`, kept for logging a stuck asset. */
  vendorState: string | null;
  /** Human-readable failure reason; null unless `status === "failed"`. */
  errorReason: string | null;
  /** `content_assets.duration_seconds`; null while Cloudflare reports -1. */
  durationSeconds: number | null;
  /** `content_assets.width`; null while Cloudflare reports -1. */
  width: number | null;
  /** `content_assets.height`; null while Cloudflare reports -1. */
  height: number | null;
  /** `content_assets.bytes`; null until Cloudflare has sized the upload. */
  sizeBytes: number | null;
}

/**
 * Cloudflare uses `-1` as "not known yet" for duration, width, and height —
 * the values appear after upload but before the video is ready. Writing -1
 * into `content_assets` would render as a real dimension somewhere downstream,
 * so it is normalized to null here, once, rather than at each call site.
 */
function normalizeSentinel(value: number | undefined): number | null {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    return null;
  }
  return value;
}

/**
 * First value that is actually present. `??` is not enough here: Cloudflare
 * returns `errorReasonText: ""` on a healthy video rather than omitting the
 * key, so a nullish chain would stop on the empty string and report a failure
 * with no reason attached.
 */
function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Read one video's processing state, plus the metadata `content_assets` needs
 * on the ready transition.
 *
 * Spec §3.5b: upload completion and playability are separate events, so an
 * asset row carries `processing` until this reports `ready`. Kelsey's Release
 * action is blocked until every asset in the cycle is ready — otherwise
 * clients open dead players, which is the failure this whole slice exists to
 * prevent.
 *
 * Readiness requires BOTH `readyToStream === true` AND
 * `status.state === "ready"`. Cloudflare flips `readyToStream` as soon as the
 * FIRST quality level finishes encoding, while `state` reaches `ready` only
 * when the full ladder is done. The adaptive ladder is the entire reason for
 * choosing Stream over plain object storage (spec §3.2), so releasing on the
 * first rendition would hand a client on a weak connection exactly the
 * experience Stream was adopted to avoid. At 6–15s clip lengths the gap
 * between the two is seconds.
 *
 * Anything else is `processing`, including `pendingupload` — a UID minted by
 * `createDirectUploadUrl` whose upload never happened sits there indefinitely.
 * That is a stalled upload (spec §3.7), not a failure, and this function does
 * not try to distinguish them; callers time it out on their own clock.
 *
 * Throws on missing env, non-2xx (a 404 here means the video does not exist —
 * a Stream-side deletion or a bad `external_id`), or `success: false`.
 */
export async function getVideoStatus(uid: string): Promise<StreamVideoStatus> {
  const video = await callStreamApi<StreamVideo>(
    `/${encodeURIComponent(uid)}`,
    "GET"
  );

  if (!video) {
    throw new Error(`Cloudflare Stream returned no video details for ${uid}`);
  }

  const vendorState = video.status?.state ?? null;
  const isFailed = vendorState === "error";
  const isReady = video.readyToStream === true && vendorState === "ready";

  const status: StreamAssetStatus = isFailed
    ? "failed"
    : isReady
      ? "ready"
      : "processing";

  const errorReason = isFailed
    ? (firstNonEmpty(
        video.status?.errorReasonText,
        video.status?.errReasonText,
        video.status?.errorReasonCode,
        video.status?.errReasonCode
      ) ?? "Cloudflare Stream reported an encoding error with no reason")
    : null;

  return {
    uid: video.uid ?? uid,
    status,
    vendorState,
    errorReason,
    durationSeconds: normalizeSentinel(video.duration),
    width: normalizeSentinel(video.input?.width),
    height: normalizeSentinel(video.input?.height),
    sizeBytes: normalizeSentinel(video.size),
  };
}

export interface StreamPlaybackToken {
  /** Signed JWT. Substitutes for the video UID in a playback URL. */
  token: string;
  /** Unix seconds. Lets a caller schedule a refresh before playback dies. */
  expiresAt: number;
}

/** base64url per RFC 7515: no padding, `-`/`_` in place of `+`/`/`. */
function base64Url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buffer.toString("base64url");
}

/**
 * Mint a short-lived signed playback token for one video UID.
 *
 * Spec §3.5a: Stream URLs are public to anyone holding them, so every video is
 * minted with `requireSignedURLs: true` and playback requires a token. Mint
 * this ONLY after verifying the requesting client owns the content item —
 * Pattern B from the integration audit (fetch the row, compare `client_id`,
 * then mint), the same shape as `createFileDownloadUrlAction`. This function
 * performs no authorization of its own; handing it a UID is enough to unlock
 * that video for an hour.
 *
 * Signed locally rather than via Cloudflare's `POST /stream/{uid}/token`
 * endpoint. Cloudflare documents both and recommends local signing for
 * anything beyond testing: the API route costs a round trip per playback and
 * is rate-limited, while a signing key is neither. This is why
 * scripts/create-stream-signing-key.mjs exists.
 *
 * Synchronous on purpose — an RSA signature is CPU-only. If this ever needs
 * `await`, something has started making a network call and the rate-limit
 * argument above has quietly been given up.
 *
 * Token shape, per Cloudflare's signing-key docs:
 *   header  { alg: "RS256", kid }
 *   payload { sub: <video uid>, kid, exp }
 * `nbf` is deliberately omitted. Cloudflare's own /token endpoint backdates it
 * an hour, which exists purely to absorb clock skew; setting it to "now" from
 * a serverless box whose clock runs slightly fast would reject the very first
 * playback request. Leaving it out is strictly safer and costs nothing.
 * `accessRules` are omitted too — geo/IP restriction is not a requirement
 * anywhere in the spec, and clients travel.
 *
 * CLOUDFLARE_STREAM_SIGNING_KEY_PEM is base64 (that is the form Cloudflare
 * returns and the only form that survives .env parsing and Vercel's env UI on
 * one line), so it is decoded before signing. A raw PEM pasted into that var
 * would base64-decode to binary garbage and fail inside OpenSSL with an
 * unrecoverable error message, so the decode is checked here instead.
 *
 * The caller builds the URL by substituting the token FOR the video UID:
 *   https://<CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN>/<token>/iframe
 *   https://<CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN>/<token>/manifest/video.m3u8
 * That assembly belongs to the playback surface in slice 2.4.
 *
 * Throws on missing env or a PEM that does not decode to a PEM.
 */
export function createPlaybackToken(uid: string): StreamPlaybackToken {
  const keyId = requireEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID");
  const encodedPem = requireEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM");

  const pem = Buffer.from(encodedPem, "base64").toString("utf8");
  if (!pem.trimStart().startsWith("-----BEGIN")) {
    throw new Error(
      "CLOUDFLARE_STREAM_SIGNING_KEY_PEM did not base64-decode to a PEM — " +
        "it must hold the base64 value Cloudflare returned, not the PEM itself"
    );
  }

  const expiresAt =
    Math.floor(Date.now() / 1000) + PLAYBACK_TOKEN_TTL_SECONDS;

  const header = { alg: "RS256", kid: keyId };
  const payload = { sub: uid, kid: keyId, exp: expiresAt };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(payload)
  )}`;

  // RSA-SHA256 is RSASSA-PKCS1-v1_5 with SHA-256 — the `alg: "RS256"` the
  // header advertises and the algorithm Cloudflare's own example signs with.
  const signature = createSign("RSA-SHA256").update(signingInput).sign(pem);

  return { token: `${signingInput}.${base64Url(signature)}`, expiresAt };
}

/**
 * Hard-delete a video and its renditions from Cloudflare Stream.
 *
 * DO NOT COPY THE FILES-FEATURE DELETE PATTERN HERE. `deleteFileAction`
 * deletes the DB row first and treats a failed Supabase storage delete as an
 * acceptable, logged orphan — a few stray bytes in a bucket we already pay a
 * flat rate for. That trade does not transfer. Spec §3.5c: no foreign key
 * relates `content_assets.external_id` to anything in Stream, so once the row
 * is gone the UID is gone with it, and the video keeps consuming storage
 * minutes against the prepaid block in §3.3 forever. Nothing surfaces an
 * error, nothing reconciles, and nobody finds out. It is silent and it is
 * permanent.
 *
 * So: callers must NOT swallow a throw from this function. Delete the Stream
 * video first and only clear the row once it succeeds; on failure, surface it
 * and leave the row intact so the UID is still recoverable and a retry is
 * possible. An asset row pointing at an already-deleted video is a cheap,
 * fixable inconsistency; a video with no row is unrecoverable.
 *
 * Called on the accept-a-revision path (the superseded video, spec §3.5c) and
 * on any content item or asset deletion.
 *
 * Throws on missing env, non-2xx, or `success: false`. A 404 surfaces as a
 * throw rather than a silent success — the caller decides whether an
 * already-absent video is acceptable, because this module cannot tell that
 * apart from a mistyped UID that is still costing money.
 */
export async function deleteVideo(uid: string): Promise<void> {
  await callStreamApi<null>(`/${encodeURIComponent(uid)}`, "DELETE");
}
