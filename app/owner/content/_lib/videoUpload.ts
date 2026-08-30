"use client";

import {
  createContentVideoUploadAction,
  finalizeContentVideoAssetAction,
} from "../_actions";

/**
 * The resumable video upload, kept in MODULE scope rather than panel state.
 *
 * Why not `useState` in ItemFormPanel: the panel unmounts. It unmounts when
 * Kelsey closes it, when she taps another post, and when she navigates to
 * another owner page — all of which are things a person does while waiting on
 * a slow upload. React state dies with the component, and with it the tus
 * upload, mid-file, with no way back. A module-scope singleton lives as long
 * as the document does, so the panel becomes a VIEW of an upload that owns
 * itself. `subscribeVideoUpload` / `getVideoUploadSnapshot` are the
 * `useSyncExternalStore` pair the panel renders from.
 *
 * WHAT THIS DOES NOT DO, and must never be described as doing: it does not
 * upload in the background. There is no background upload API in Safari.
 * Closing the tab, hard-refreshing, or backgrounding the app on an iPhone
 * SUSPENDS the transfer. What survives is the byte offset: the tus upload URL
 * is written to localStorage, and re-picking the same file continues from
 * exactly where it stopped instead of restarting the file. Every string this
 * module hands the UI is written to match that and nothing more — anything
 * implying she can close the app and walk away would be a lie that costs her
 * a re-upload on cellular data.
 *
 * One upload at a time, deliberately. She is one person on one phone, and
 * serializing means the whole connection goes to the video that is actually
 * in front of her.
 */

/**
 * tus chunk size, in bytes: 10 MiB, which is 40 × 256 KiB.
 *
 * Cloudflare requires every chunk except the last to be an exact multiple of
 * 256 KiB, and rejects the upload outright otherwise — this is not a tuning
 * knob that degrades gracefully. 10 MiB is well inside their 5 MiB–200 MiB
 * band and keeps the number of round trips low on a phone, where per-request
 * latency dominates over cellular.
 */
const TUS_CHUNK_SIZE = 10 * 1024 * 1024;

/**
 * tus's own retry ladder for transient network failures, in ms. These are
 * silent, automatic retries INSIDE one upload — `onError` fires only after
 * the ladder is exhausted, which is the point where a human has to be told.
 */
const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];

/**
 * localStorage key holding the one in-flight upload.
 *
 * Versioned because the record's shape is a contract with a future build:
 * a stale record from an older shape must be ignored, not misread. Bump the
 * suffix rather than migrating.
 */
const RESUME_KEY = "dbs.contentVideoUpload.v1";

/**
 * What has to survive a page reload to make resuming possible.
 *
 * `filename` / `sizeBytes` / `lastModified` are not bookkeeping — they are the
 * guard. After a refresh the File object is gone and only the person can
 * supply it again. Continuing a tus upload with DIFFERENT bytes would splice
 * two files together at the offset and produce a corrupt video that uploads
 * and encodes without any error at all. So a re-picked file is checked
 * against all three before a single byte is sent.
 */
interface ResumeRecord {
  itemId: string;
  assetId: string;
  uid: string;
  uploadUrl: string;
  filename: string;
  sizeBytes: number;
  lastModified: number;
}

export type VideoUploadPhase =
  /** Bytes are moving right now. */
  | "uploading"
  /** Upload accepted; the server action is writing metadata onto the row. */
  | "finalizing"
  /** Stopped, and continuable. `needsFile` says whether a re-pick is needed. */
  | "paused";

export interface VideoUploadState {
  itemId: string;
  assetId: string;
  filename: string;
  sizeBytes: number;
  /** 0–1. */
  progress: number;
  phase: VideoUploadPhase;
  /** Non-null only while paused. Always human-readable, never silent. */
  error: string | null;
  /**
   * True when the File is no longer in memory (a reload happened), so
   * continuing requires the same file to be picked again.
   */
  needsFile: boolean;
  /**
   * False when the tus upload link itself is gone — expired or already
   * completed server-side. Resuming cannot work; the tile has to be removed
   * and the video re-added.
   */
  recoverable: boolean;
}

export interface VideoUploadSnapshot {
  active: VideoUploadState | null;
  /**
   * Increments once per successful finalize. The panel watches this rather
   * than a callback, because the panel that started an upload is frequently
   * not the panel instance that sees it finish.
   */
  completions: number;
}

const EMPTY: VideoUploadSnapshot = { active: null, completions: 0 };

let snapshot: VideoUploadSnapshot = EMPTY;
const listeners = new Set<() => void>();

/** The live tus upload and its File. Never serialized, never in the snapshot. */
let activeUpload: { abort: (t?: boolean) => Promise<void> } | null = null;
let activeFile: File | null = null;
/**
 * The in-memory twin of the localStorage record.
 *
 * localStorage is not a dependency for resuming WITHIN a session — it throws
 * outright in Safari private browsing, and a failed write there must not cost
 * her the ability to retry an upload whose File is still in memory. The
 * stored copy exists for the reload case only; this one covers everything
 * else, and reads prefer it.
 */
let activeRecord: ResumeRecord | null = null;
let hydrated = false;

/** The record to resume from: memory first, then whatever survived a reload. */
function currentRecord(): ResumeRecord | null {
  return activeRecord ?? readRecord();
}

function emit(next: VideoUploadSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function setActive(active: VideoUploadState | null) {
  emit({ active, completions: snapshot.completions });
}

// ---------------------------------------------------------------------------
// Resume record persistence. Every access is wrapped: localStorage throws
// outright in Safari private browsing, and a storage failure must degrade to
// "cannot resume after a reload", never to a broken upload.
// ---------------------------------------------------------------------------

function readRecord(): ResumeRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResumeRecord>;
    if (
      typeof parsed?.itemId !== "string" ||
      typeof parsed.assetId !== "string" ||
      typeof parsed.uid !== "string" ||
      typeof parsed.uploadUrl !== "string" ||
      typeof parsed.filename !== "string" ||
      typeof parsed.sizeBytes !== "number" ||
      typeof parsed.lastModified !== "number"
    ) {
      return null;
    }
    return parsed as ResumeRecord;
  } catch {
    return null;
  }
}

function writeRecord(record: ResumeRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RESUME_KEY, JSON.stringify(record));
  } catch {
    // Resume-after-reload is unavailable. The in-memory upload is unaffected.
  }
}

function clearRecord(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RESUME_KEY);
  } catch {
    // Nothing to do; a stale record is rejected on re-pick by the file guard.
  }
}

// ---------------------------------------------------------------------------
// Leaving the page mid-upload
// ---------------------------------------------------------------------------

function onBeforeUnload(event: BeforeUnloadEvent) {
  // The browser shows its own generic wording; the value only has to be set.
  event.preventDefault();
  event.returnValue = "";
}

/**
 * Warn on tab close / reload while bytes are moving. This is the honest
 * counterpart to the resume machinery: the upload really does stop here, and
 * a prompt is the only moment we get to say so before it does.
 */
function setUnloadGuard(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) window.addEventListener("beforeunload", onBeforeUnload);
  else window.removeEventListener("beforeunload", onBeforeUnload);
}

// ---------------------------------------------------------------------------
// Store API
// ---------------------------------------------------------------------------

/**
 * Hydration happens here rather than at module load: `subscribe` runs only in
 * the browser, only after mount, so it cannot desync a server render.
 */
export function subscribeVideoUpload(listener: () => void): () => void {
  if (!hydrated) {
    hydrated = true;
    const record = readRecord();
    if (record) {
      activeRecord = record;
      snapshot = {
        active: {
          itemId: record.itemId,
          assetId: record.assetId,
          filename: record.filename,
          sizeBytes: record.sizeBytes,
          // The real offset is only knowable from the tus HEAD that resuming
          // performs, so it is not guessed here.
          progress: 0,
          phase: "paused",
          error: "Upload paused when the page reloaded.",
          needsFile: true,
          recoverable: true,
        },
        completions: snapshot.completions,
      };
    }
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVideoUploadSnapshot(): VideoUploadSnapshot {
  return snapshot;
}

/** Server render has no upload and no localStorage. Constant by construction. */
export function getVideoUploadServerSnapshot(): VideoUploadSnapshot {
  return EMPTY;
}

// ---------------------------------------------------------------------------
// Error shaping
// ---------------------------------------------------------------------------

/**
 * tus errors arrive as one long line carrying the method, URL, status and
 * body. Useful in a console, useless in a panel, so the vendor detail is
 * trimmed to its tail and prefixed with something actionable.
 */
function describeUploadError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const compact = raw.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}…` : compact;
}

/**
 * A 404/410 on the tus URL means the upload link is gone — expired, or the
 * upload already completed server-side. No amount of retrying brings it back,
 * so the UI must offer removal instead of a retry that cannot succeed.
 */
function isDeadUploadUrl(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /response code: (404|410)/.test(raw);
}

// ---------------------------------------------------------------------------
// Driving one upload
// ---------------------------------------------------------------------------

async function runUpload(record: ResumeRecord, file: File): Promise<void> {
  // Loaded on demand so tus-js-client is never pulled into the server bundle:
  // its default entry point is the Node build, which reaches for `fs` through
  // proper-lockfile. A dynamic import keeps the browser build, and only the
  // browser build, in play.
  const tus = await import("tus-js-client");

  let lastPercent = -1;

  const upload = new tus.Upload(file, {
    // Passing an existing uploadUrl (rather than an endpoint) is what makes
    // this a resume: tus HEADs the URL for its current Upload-Offset and
    // sends only the bytes after it. On a fresh mint the offset is 0, so the
    // same code path covers both cases.
    uploadUrl: record.uploadUrl,
    chunkSize: TUS_CHUNK_SIZE,
    retryDelays: RETRY_DELAYS,
    // Our own record in localStorage is the resume story; tus's parallel
    // fingerprint store would be a second, unreconciled copy of it.
    storeFingerprintForResuming: false,
    metadata: {},
    onProgress: (bytesSent, bytesTotal) => {
      const progress = bytesTotal > 0 ? bytesSent / bytesTotal : 0;
      const percent = Math.round(progress * 100);
      // Progress events fire far faster than the eye can read. Re-rendering
      // only on a whole-percent change keeps a 500 MB upload from spending
      // the phone's CPU on React instead of on the transfer.
      if (percent === lastPercent) return;
      lastPercent = percent;
      setActive({
        itemId: record.itemId,
        assetId: record.assetId,
        filename: record.filename,
        sizeBytes: record.sizeBytes,
        progress,
        phase: "uploading",
        error: null,
        needsFile: false,
        recoverable: true,
      });
    },
    onError: (err) => {
      activeUpload = null;
      setUnloadGuard(false);
      const dead = isDeadUploadUrl(err);
      setActive({
        itemId: record.itemId,
        assetId: record.assetId,
        filename: record.filename,
        sizeBytes: record.sizeBytes,
        progress: snapshot.active?.progress ?? 0,
        phase: "paused",
        error: dead
          ? `This upload link has expired, so it can't be continued. Remove the video below and add it again. (${describeUploadError(err)})`
          : `Upload stopped. Nothing was lost — continuing picks up from where it stopped. (${describeUploadError(err)})`,
        needsFile: activeFile === null,
        recoverable: !dead,
      });
      if (dead) clearRecord();
    },
    onSuccess: () => {
      activeUpload = null;
      setUnloadGuard(false);
      void finalize(record);
    },
  });

  activeUpload = upload;
  activeFile = file;
  activeRecord = record;
  setUnloadGuard(true);

  setActive({
    itemId: record.itemId,
    assetId: record.assetId,
    filename: record.filename,
    sizeBytes: record.sizeBytes,
    progress: 0,
    phase: "uploading",
    error: null,
    needsFile: false,
    recoverable: true,
  });

  upload.start();
}

async function finalize(record: ResumeRecord): Promise<void> {
  setActive({
    itemId: record.itemId,
    assetId: record.assetId,
    filename: record.filename,
    sizeBytes: record.sizeBytes,
    progress: 1,
    phase: "finalizing",
    error: null,
    needsFile: false,
    recoverable: true,
  });

  const result = await finalizeContentVideoAssetAction(record.assetId);

  if (!result.ok) {
    // The bytes are in Stream and the row already points at them — this is a
    // metadata write that did not land, not a lost upload. The record is
    // cleared because there is nothing left to resume, and the wording must
    // not push her into re-uploading a video that is already stored.
    clearRecord();
    activeRecord = null;
    activeFile = null;
    setActive({
      itemId: record.itemId,
      assetId: record.assetId,
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      progress: 1,
      phase: "paused",
      error: result.error ?? "The video uploaded but its details didn't save.",
      needsFile: false,
      recoverable: false,
    });
    return;
  }

  clearRecord();
  activeRecord = null;
  activeFile = null;
  emit({ active: null, completions: snapshot.completions + 1 });
}

// ---------------------------------------------------------------------------
// Commands the panel calls
// ---------------------------------------------------------------------------

export interface StartResult {
  ok: boolean;
  error?: string;
}

/**
 * Mint the upload (which also writes the `content_assets` row) and start
 * sending bytes.
 *
 * Returns the mint failure to the caller so it lands in the panel's alert
 * region; everything after the mint is reported through the store, because by
 * then the upload outlives whoever started it.
 */
export async function startVideoUpload(
  itemId: string,
  file: File
): Promise<StartResult> {
  if (snapshot.active) {
    return {
      ok: false,
      error: "Another video is still uploading — finish that one first.",
    };
  }

  const ticket = await createContentVideoUploadAction({
    itemId,
    sizeBytes: file.size,
  });
  if (!ticket.ok || !ticket.data) {
    return { ok: false, error: ticket.error ?? "Could not start upload" };
  }

  const record: ResumeRecord = {
    itemId,
    assetId: ticket.data.assetId,
    uid: ticket.data.uid,
    uploadUrl: ticket.data.uploadUrl,
    filename: file.name,
    sizeBytes: file.size,
    lastModified: file.lastModified,
  };
  // Written BEFORE the first byte: a reload one second into the upload must
  // still find the URL, otherwise the row exists with no way to reach it.
  writeRecord(record);

  try {
    await runUpload(record, file);
    return { ok: true };
  } catch (err) {
    setActive({
      itemId,
      assetId: record.assetId,
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      progress: 0,
      phase: "paused",
      error: `Upload couldn't start. (${describeUploadError(err)})`,
      // The row and the upload URL both exist, so this is continuable. Which
      // control she gets depends on whether the File survived — it has not
      // been captured yet if the failure was in loading tus itself.
      needsFile: activeFile === null,
      recoverable: true,
    });
    // Reported through the store rather than as a return value: the row was
    // minted, so the caller still needs to refresh the strip and show its tile.
    return { ok: true };
  }
}

/**
 * Continue a paused upload using the File still held in memory.
 *
 * Returns false when the File is gone — after a reload there is nothing to
 * send until the same file is picked again, which is `resumeVideoUploadWithFile`.
 */
export function retryVideoUpload(): boolean {
  const active = snapshot.active;
  if (!active || active.phase !== "paused" || !active.recoverable) return false;
  const record = currentRecord();
  if (!record || !activeFile) return false;
  void runUpload(record, activeFile);
  return true;
}

/**
 * Continue a paused upload with a re-picked file, after a reload emptied the
 * in-memory File.
 *
 * The three-way identity check is the safety-critical part. tus resumes at a
 * byte offset and asks no questions about what is on the other side of it, so
 * handing it a different file would append the tail of one video to the head
 * of another. Cloudflare would accept that, encode it, and mark it ready.
 * Nothing downstream would ever flag it. Refusing here is the only place this
 * can be caught.
 */
export function resumeVideoUploadWithFile(file: File): StartResult {
  const record = currentRecord();
  if (!record) {
    return {
      ok: false,
      error: "That upload can no longer be continued. Remove it and try again.",
    };
  }
  if (
    file.name !== record.filename ||
    file.size !== record.sizeBytes ||
    file.lastModified !== record.lastModified
  ) {
    return {
      ok: false,
      error: `That's a different file. Pick “${record.filename}” to continue where it stopped, or remove the video below and start over.`,
    };
  }
  void runUpload(record, file);
  return { ok: true };
}

/**
 * Forget the tracked upload without touching anything server-side.
 *
 * Called when the asset row is deleted (which is what removes the video from
 * Cloudflare) and after an acknowledged failure. It deliberately does NOT
 * terminate the tus upload: the row's `external_id` is what the delete action
 * uses to remove the video, and that path is the one with the error handling.
 */
export function dismissVideoUpload(): void {
  void activeUpload?.abort();
  activeUpload = null;
  activeRecord = null;
  activeFile = null;
  setUnloadGuard(false);
  clearRecord();
  setActive(null);
}
