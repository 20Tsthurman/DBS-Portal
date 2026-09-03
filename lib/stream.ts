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
 * CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN is read here, by `createPlaybackUrls`.
 * Slice 2.2 left that assembly to "the playback surface in slice 2.4" on the
 * assumption the surface would want the token; building 2.4 showed it wants a
 * URL, and lib/storage.ts had already settled the question — its
 * `createSignedDownloadUrl` hands back a complete URL, not a signature for
 * the caller to finish. Keeping the vendor's URL SHAPES in the vendor module
 * means a Cloudflare path change touches one file instead of every surface
 * that plays a video. `createPlaybackToken` stays exported as the signing
 * primitive underneath it.
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
 *     of at most 200 MB. It is NOT a tus endpoint. The resumable path is a
 *     separate Cloudflare call, implemented as `createResumableUploadUrl`
 *     below; that is the one the review-video upload path uses.
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

// ---------------------------------------------------------------------------
// Resumable (tus) direct creator upload — slice 2.3
// ---------------------------------------------------------------------------

/** The only tus protocol version Cloudflare's Stream endpoint speaks. */
const TUS_RESUMABLE_VERSION = "1.0.0";

export interface StreamResumableUpload {
  /**
   * One-time tus endpoint the BROWSER uploads to (HEAD for the offset, PATCH
   * for each chunk). Never proxied through our server — that is the whole
   * point (spec §3.6, Vercel's ~4.5 MB body limit).
   */
  uploadUrl: string;
  /** The Stream video UID. Store this on `content_assets.external_id`. */
  uid: string;
}

/**
 * Build the tus `Upload-Metadata` header.
 *
 * Format is a comma-separated list of `key base64(value)` pairs. Two keys are
 * sent, and both are load-bearing:
 *
 *   - `maxDurationSeconds` — base64 of MAX_UPLOAD_DURATION_SECONDS. Derived
 *     from the constant rather than hardcoded so the cap cannot drift between
 *     the two upload paths; at 120 this renders as `MTIw`.
 *   - `requiresignedurls` — a VALUELESS key, which the tus spec allows and
 *     which is how Cloudflare expects this flag. It is the tus-path
 *     equivalent of `requireSignedURLs: true` in the JSON body of
 *     `createDirectUploadUrl`, and it is not optional: spec §3.5a requires it
 *     on every video, and setting it at creation means the video is never
 *     briefly public between upload and a follow-up PATCH. Note the all
 *     lowercase spelling — Cloudflare's metadata key is NOT the camelCase
 *     `requireSignedURLs` used in the JSON body, and an unrecognized metadata
 *     key is ignored rather than rejected, so a misspelling here would ship a
 *     public video with nothing anywhere reporting a problem.
 *
 * No `expiry` key is sent, matching `createDirectUploadUrl`: Cloudflare's
 * default link lifetime applies, and the permitted `expiry` range is not
 * documented well enough to tighten blind.
 */
function buildUploadMetadata(): string {
  const maxDuration = Buffer.from(
    String(MAX_UPLOAD_DURATION_SECONDS),
    "utf8"
  ).toString("base64");
  return `maxDurationSeconds ${maxDuration},requiresignedurls`;
}

/**
 * True when `uid` appears as a path segment of the tus `Location` URL.
 *
 * Matched against ANY segment rather than the last one: the observed shape is
 * `https://upload.videodelivery.net/tus/<uid>?tusv2=true`, but pinning the
 * position would turn a harmless vendor URL reshuffle into an outage.
 */
function locationCarriesUid(location: string, uid: string): boolean {
  let path: string;
  try {
    path = new URL(location).pathname;
  } catch {
    // A relative Location is legal per tus; fall back to the raw value with
    // any query string trimmed off.
    path = location.split("?")[0];
  }
  return path.split("/").some((segment) => segment === uid);
}

/**
 * Mint a RESUMABLE (tus) Direct Creator Upload and reserve the video's UID.
 *
 * This is the sibling of `createDirectUploadUrl`, not a variant of it, and it
 * deliberately does NOT go through `callStreamApi`. Two reasons, both
 * structural rather than stylistic:
 *   - `callStreamApi` is JSON in, JSON envelope out. A tus creation responds
 *     `201` with an EMPTY body and puts everything that matters in response
 *     HEADERS, which `callStreamApi` never reads.
 *   - The request carries no JSON body at all; its parameters are headers
 *     (`Upload-Length`, `Upload-Metadata`).
 * Sharing `requireEnv` and `accountStreamUrl` keeps the account/token
 * plumbing in one place, which is the part that actually matters.
 *
 * Why tus at all, when `createDirectUploadUrl` already exists: that endpoint
 * takes exactly one `POST multipart/form-data` and a dropped connection
 * restarts the whole file. Spec §3.7 says a stalled upload on iPhone/Safari
 * is the NORMAL case here, so the review-video path needs an upload that can
 * be resumed from its byte offset, which is what tus buys.
 *
 * `sizeBytes` is required because tus `Upload-Length` is required at
 * creation. Deferred-length uploads exist in the protocol, but Cloudflare
 * uses the declared length to size the reservation, so it is always declared.
 *
 * There is no in-band `success: false` check here the way `callStreamApi`
 * does one — a successful tus creation carries no envelope to check. The
 * failure path re-parses the body because Cloudflare DOES return its normal
 * JSON envelope on a non-2xx, and those error codes are the only useful
 * diagnostic when a token is wrong or the account is out of storage.
 *
 * The UID is returned before a single byte is uploaded, and the caller
 * inserts `content_assets` at THAT point rather than after the upload
 * finishes. That is deliberate: an upload that completes and then fails to be
 * recorded leaves a fully-billed video that nothing in the app can find —
 * spec §3.5c's silent leak, and the one failure mode with no recovery path. A
 * row minted here and never uploaded to is the harmless inverse; Cloudflare
 * releases the duration reservation when the link expires.
 *
 * Throws on missing env, a non-positive size, non-2xx, a missing `Location`
 * or `stream-media-id` header, or a UID that disagrees with the one embedded
 * in the upload URL.
 */
export async function createResumableUploadUrl(
  sizeBytes: number
): Promise<StreamResumableUpload> {
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(
      `Cloudflare Stream tus upload requires a positive integer Upload-Length, got ${sizeBytes}`
    );
  }

  const apiToken = requireEnv("CLOUDFLARE_STREAM_TOKEN");

  const res = await fetch(accountStreamUrl("?direct_user=true"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Tus-Resumable": TUS_RESUMABLE_VERSION,
      "Upload-Length": String(sizeBytes),
      "Upload-Metadata": buildUploadMetadata(),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const raw = await res.text();
    let envelope: StreamEnvelope<unknown> | null = null;
    if (raw.trim().length > 0) {
      try {
        envelope = JSON.parse(raw) as StreamEnvelope<unknown>;
      } catch {
        envelope = null;
      }
    }
    throw new Error(
      `Cloudflare Stream tus upload creation failed: HTTP ${res.status}${describeErrors(envelope)}`
    );
  }

  const uploadUrl = res.headers.get("Location");
  const uid = res.headers.get("stream-media-id");

  if (!uploadUrl) {
    throw new Error(
      "Cloudflare Stream tus upload creation returned no Location header"
    );
  }
  if (!uid) {
    throw new Error(
      "Cloudflare Stream tus upload creation returned no stream-media-id header"
    );
  }

  // Belt and braces on the one value that can never be wrong. `external_id`
  // is the ONLY pointer from Postgres back to the video (spec §3.5c — no
  // foreign key, nothing reconciles), so storing a UID that does not name the
  // video the bytes land in produces a row that can never be played and a
  // video that can never be deleted. Both headers describe the same creation,
  // so a disagreement means the vendor contract moved, and the right response
  // is to fail loudly before anything is persisted.
  if (!locationCarriesUid(uploadUrl, uid)) {
    throw new Error(
      `Cloudflare Stream tus upload URL does not carry uid ${uid} — refusing to persist a mismatched external_id`
    );
  }

  return { uploadUrl, uid };
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
  /**
   * Cloudflare's raw `errorReasonCode` (e.g. ERR_DURATION_EXCEED_CONSTRAINT);
   * null unless `status === "failed"`. Separated from `errorReason` because
   * the CODE is the stable, matchable half of the pair — the TEXT is prose
   * Cloudflare is free to reword. `describeStreamError` keys off this.
   */
  errorCode: string | null;
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

  const errorCode = isFailed
    ? firstNonEmpty(
        video.status?.errorReasonCode,
        video.status?.errReasonCode
      )
    : null;

  return {
    uid: video.uid ?? uid,
    status,
    vendorState,
    errorReason,
    errorCode,
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
 * Render a second count the way a person would say it. Used only to keep the
 * duration-cap message in `describeStreamError` derived from
 * MAX_UPLOAD_DURATION_SECONDS rather than restating "2 minutes" in prose that
 * would silently go wrong the day the cap moves.
 */
function describeDuration(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  return `${seconds} seconds`;
}

/**
 * Turn a Cloudflare encoding failure into something Kelsey can act on.
 *
 * Cloudflare documents five `errorReasonCode` values. Each maps to prose that
 * names the actual problem AND the next step, because the owner surface has
 * exactly one place to put this and a message that only says "failed" leads
 * to the same file being uploaded a second time — a second carousel slot and
 * a second reservation against the prepaid block in spec §3.3.
 *
 * ERR_DURATION_EXCEED_CONSTRAINT is the one that matters. Every upload is
 * minted with `maxDurationSeconds` = MAX_UPLOAD_DURATION_SECONDS (spec §3.5d)
 * and an over-length clip does not fail at upload time — the POST succeeds and
 * the video errors during processing. It is the most likely failure this
 * feature will ever produce, it is self-inflicted, and it is trivially
 * fixable, but only if the message says the clip is too long.
 *
 * An unrecognized code falls through to Cloudflare's own `errorReasonText`,
 * with a generic remedy appended so the tile is never a dead end. A vendor
 * adding a sixth code degrades the wording; it never breaks the write.
 */
export function describeStreamError(
  failure: Pick<StreamVideoStatus, "errorCode" | "errorReason">
): string {
  switch (failure.errorCode) {
    case "ERR_DURATION_EXCEED_CONSTRAINT":
      return (
        `This clip is longer than ${describeDuration(MAX_UPLOAD_DURATION_SECONDS)}. ` +
        `Trim it and upload it again.`
      );
    case "ERR_DURATION_TOO_SHORT":
      return (
        "This clip is too short to encode — Cloudflare needs at least a tenth " +
        "of a second. Check that the whole file finished exporting, then " +
        "upload it again."
      );
    case "ERR_MALFORMED_VIDEO":
      return (
        "This is a video file, but its data is damaged and can't be encoded. " +
        "Re-export it from the original and upload it again."
      );
    case "ERR_FETCH_ORIGIN_ERROR":
      return (
        "Cloudflare couldn't read the uploaded file. Upload it again — if it " +
        "fails a second time, re-export it first."
      );
    case "ERR_UNKNOWN":
      return (
        "Cloudflare couldn't encode this video and didn't say why. Re-export " +
        "it and upload it again; if it fails again, the file itself is the " +
        "problem."
      );
    default:
      break;
  }

  // No code, or one this map has not met. Cloudflare's own text is the best
  // description available, so lead with it and add the remedy it lacks.
  const vendorText = failure.errorReason?.trim();
  if (vendorText) {
    return `Cloudflare couldn't encode this video: ${vendorText}. Remove it and upload the clip again.`;
  }
  return "Cloudflare couldn't encode this video. Remove it and upload the clip again.";
}

/**
 * Poster frame dimensions, 9:16 — media is vertical throughout and is never
 * cropped to square or 16:9 (spec §3.9). Sent explicitly because Cloudflare's
 * thumbnail endpoint defaults to 640x640 with `fit=crop`, which would
 * centre-crop a vertical clip into a square and silently violate that rule.
 */
const POSTER_WIDTH = 360;
const POSTER_HEIGHT = 640;

/**
 * Offset the poster frame is taken from.
 *
 * `0s` rather than Cloudflare's `1s` example. A first frame is occasionally
 * black, which `1s` would avoid — but nothing enforces a MINIMUM clip length
 * (their own floor is 0.1s, below which the video errors outright), so `1s`
 * can land past the end of a short clip while `0s` is in range for every
 * video that encoded at all. A dark thumbnail on a valid video is cosmetic; a
 * broken one is not.
 */
const POSTER_TIME = "0s";

export interface StreamPlaybackUrls {
  /** `src` for the Stream player iframe. Already carries the poster. */
  iframeUrl: string;
  /** Signed still for the tile, before anyone presses play. */
  posterUrl: string;
  /** Unix seconds — both URLs die together. Mirrors `createPlaybackToken`. */
  expiresAt: number;
}

/**
 * Mint a signed token and assemble the URLs a playback surface actually needs.
 *
 * Like `createPlaybackToken`, this authorizes nothing: handing it a UID
 * unlocks that video for an hour, so ownership MUST be verified first (spec
 * §3.5a, Pattern B from the integration audit).
 *
 * Cloudflare's rule is that the token substitutes for the video UID in the
 * path — the same token works for the player, the manifests, and the
 * thumbnails:
 *   https://<subdomain>/<token>/iframe
 *   https://<subdomain>/<token>/thumbnails/thumbnail.jpg
 *   https://<subdomain>/<token>/manifest/video.m3u8   (unused here)
 *
 * The IFRAME player is what this returns, not an HLS manifest, and that is a
 * browser-support decision rather than a preference: Safari plays HLS in a
 * bare <video> element, Chrome and Firefox do not and need hls.js. Kelsey
 * builds months on desktop Chrome (spec §3.7), so the manifest path would be
 * dead in the one browser this has to work in — and it would cost a runtime
 * dependency to revive. The iframe also brings the adaptive ladder that is the
 * entire reason Stream was chosen over object storage (spec §3.2).
 *
 * The trade is that a cross-origin iframe hides `currentTime` from the DOM,
 * which §3.8's `revision_notes.timestamp_seconds` will eventually want for
 * scrubber comments. That is a client-side, later-phase surface, and
 * Cloudflare's player SDK exposes `currentTime` over postMessage from this
 * same iframe — so this choice defers that dependency rather than foreclosing
 * the feature.
 *
 * Both URLs expire together, one hour out. `expiresAt` is returned so a
 * caller can refresh before a still goes stale rather than after it 403s.
 *
 * `options.autoplay` defaults to TRUE — every single-player surface mints at
 * press time, so play intent has already been expressed (see the param notes
 * below). Pass `false` for the one surface where it has not: the accept
 * flow's side-by-side compare mounts TWO players in one commit, and two
 * clips autoplaying together is two audio tracks at once. There, each player
 * waits at its poster for its own press.
 *
 * Throws on missing env (including the customer subdomain) or a bad signing
 * key — see `createPlaybackToken`.
 */
export function createPlaybackUrls(
  uid: string,
  options?: { autoplay?: boolean }
): StreamPlaybackUrls {
  // Tolerate a value pasted with a scheme or a trailing slash. Cloudflare
  // shows this as a bare host and that is what the env var holds, but the two
  // mistakes that produce `https://https://…` are silent everywhere except in
  // front of a client, so they are absorbed here.
  const subdomain = requireEnv("CLOUDFLARE_STREAM_CUSTOMER_SUBDOMAIN")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  const { token, expiresAt } = createPlaybackToken(uid);
  const base = `https://${subdomain}/${token}`;

  const posterUrl =
    `${base}/thumbnails/thumbnail.jpg` +
    `?time=${POSTER_TIME}&width=${POSTER_WIDTH}&height=${POSTER_HEIGHT}&fit=crop`;

  // Player customization rides on the src as query params — Cloudflare's
  // documented "basic options" for the Stream player. URLSearchParams so the
  // hex colors and the nested poster URL are each encoded exactly once; a
  // literal `#` would end the URL at the fragment and silently drop every
  // parameter after it.
  //
  // - poster: our own frame, so the still is identical to the tile it opened
  //   from; without it the player generates its own and the image visibly
  //   changes on press.
  // - primaryColor: the mauve accent, so the scrubber and controls read as
  //   DBS rather than Cloudflare-default blue. Duplicated from --accent in
  //   app/globals.css because this module runs server-side, where CSS custom
  //   properties do not exist; keep the two in sync.
  // - autoplay: on by default because these URLs are minted at press time, so
  //   play intent has already been expressed — landing on a paused player
  //   would demand a second press inside the frame. Browsers honour unmuted
  //   autoplay only when the embedding page delegates its click via
  //   allow="autoplay" (the playback overlay's iframe does); where a browser
  //   still refuses, the player just waits at the poster, which is the
  //   pre-autoplay behavior. The side-by-side compare passes `false` — see
  //   the function docblock.
  // - letterboxColor: the playback overlay's backdrop (--sidebar-bg), so a
  //   clip whose ratio is not exactly 9:16 pads in the overlay's green
  //   instead of black bars that outline the iframe.
  const iframeParams = new URLSearchParams({
    poster: posterUrl,
    primaryColor: "#A8788A",
    autoplay: options?.autoplay === false ? "false" : "true",
    letterboxColor: "#1B3827",
  });
  const iframeUrl = `${base}/iframe?${iframeParams.toString()}`;

  return { iframeUrl, posterUrl, expiresAt };
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
