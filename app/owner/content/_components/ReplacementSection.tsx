"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { UploadProgressIndicator } from "@/components/ui/UploadProgressIndicator";
import { useVisibilityPolling } from "@/lib/hooks/useVisibilityPolling";
import {
  createReplacementCompareAction,
  deleteContentAssetAction,
  fetchReplacementStateAction,
} from "../_actions";
import type {
  ReplacementState,
  StagedReplacement,
} from "../_lib/replacementState";
import type { AssetPreview } from "../_lib/assetPreviews";
import {
  dismissVideoUpload,
  getVideoUploadServerSnapshot,
  getVideoUploadSnapshot,
  resumeVideoUploadWithFile,
  retryVideoUpload,
  startReplacementVideoUpload,
  subscribeVideoUpload,
} from "../_lib/videoUpload";

interface ReplacementSectionProps {
  itemId: string;
  /** Panel visibility — fetch on open, tear playback down on close. */
  open: boolean;
  /**
   * The parent's window into this section's staged rows — the accept gate
   * reads them (null = not loaded yet, so accept stays disabled rather than
   * committing against an unknown swap). Fired on every load and every poll
   * transition; the parent owns nothing it could fetch better itself.
   */
  onReplacementChange?: (staged: StagedReplacement[] | null) => void;
}

/** Mirrors MAX_VIDEO_BYTES in _actions.ts; rejects a mis-pick pre-mint. */
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/** Same cadence and reasoning as the panel's own transcode poll. */
const REPLACEMENT_POLL_INTERVAL_MS = 6_000;

/**
 * The accept path's replacement upload (Phase 6, slice 6.1) — rendered by
 * `RevisionRequestSection` under the notes, only while the request is open.
 *
 * The upload itself is the Phase 2 machinery end to end: the module-scope
 * tus singleton (so it survives this component unmounting), the same
 * finalize, the same status poll route. What differs is the mint —
 * `createReplacementVideoUploadAction` writes the row STAGED (born with
 * `replaced_at` set and `replaces_asset_id` pointing at its target), so the
 * client never sees the candidate and the release gate never counts it.
 *
 * SIDE-BY-SIDE (spec §4.7): both player URLs are minted in one action at
 * press time, each with autoplay off — two clips autostarting in one commit
 * is two audio tracks at once. No Stream SDK is attached to either iframe;
 * nothing here reads position, and playback belongs to the player's own
 * controls. The commit that swaps the versions is slice 6.2, not this file —
 * until then the section offers compare and remove.
 *
 * Remove reuses `deleteContentAssetAction`, which deletes the Stream video
 * BEFORE the row — the ordering that makes an abandoned candidate cost
 * nothing instead of billing storage invisibly.
 */
export function ReplacementSection({
  itemId,
  open,
  onReplacementChange,
}: ReplacementSectionProps) {
  const [state, setState] = useState<ReplacementState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [targetAssetId, setTargetAssetId] = useState<string>("");
  const [compare, setCompare] = useState<{
    currentIframeUrl: string;
    newIframeUrl: string;
  } | null>(null);
  const [comparePending, setComparePending] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<StagedReplacement | null>(
    null
  );
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadSnapshot = useSyncExternalStore(
    subscribeVideoUpload,
    getVideoUploadSnapshot,
    getVideoUploadServerSnapshot
  );

  /** The replacement upload for THIS post, if one is running or paused. */
  const replacementUpload =
    uploadSnapshot.active &&
    uploadSnapshot.active.itemId === itemId &&
    uploadSnapshot.active.replacesAssetId !== null
      ? uploadSnapshot.active
      : null;

  /** One upload at a time is the module's rule; the button says so early. */
  const uploadBlocked =
    uploadSnapshot.active !== null && replacementUpload === null;

  const load = useCallback(async () => {
    setLoadFailed(false);
    const result = await fetchReplacementStateAction(itemId);
    if (!result.ok || !result.data) {
      setState(null);
      setLoadFailed(true);
      return;
    }
    const fresh = result.data;
    setState(fresh);
    // Default the picker to the first (usually only) video.
    setTargetAssetId((current) =>
      fresh.targets.some((t) => t.assetId === current)
        ? current
        : (fresh.targets[0]?.assetId ?? "")
    );
  }, [itemId]);

  useEffect(() => {
    if (!open) return;
    setState(null);
    setActionError(null);
    setCompare(null);
    setComparePending(false);
    void load();
  }, [open, load]);

  // Compare players unmount with the panel — SlidePanel stays in the tree
  // through its slide-out, so without this the audio would keep playing
  // behind a closed panel (the ItemFormPanel player has the same guard).
  useEffect(() => {
    if (!open) setCompare(null);
  }, [open]);

  // Every state change — the open reset to null, a load, a poll transition —
  // reaches the parent's accept gate through this one effect.
  useEffect(() => {
    onReplacementChange?.(state?.staged ?? null);
  }, [state, onReplacementChange]);

  // A finished upload (finalize included) bumps the counter; the staged row
  // now has a real status worth re-reading.
  const seenCompletions = useRef(uploadSnapshot.completions);
  useEffect(() => {
    if (uploadSnapshot.completions === seenCompletions.current) return;
    seenCompletions.current = uploadSnapshot.completions;
    void load();
  }, [uploadSnapshot.completions, load]);

  /**
   * Staged rows worth asking Cloudflare about — processing, and not the one
   * whose bytes are still moving (same exclusion, same reason as the panel's
   * poll: Cloudflare can only answer `pendingupload` mid-transfer).
   */
  const stagedProcessingIds = useMemo(
    () =>
      (state?.staged ?? [])
        .filter(
          (s) =>
            s.status === "processing" &&
            s.assetId !== replacementUpload?.assetId
        )
        .map((s) => s.assetId),
    [state, replacementUpload?.assetId]
  );

  const refreshStagedStatuses = useCallback(
    async (signal: AbortSignal) => {
      if (stagedProcessingIds.length === 0) return;
      try {
        const res = await fetch("/api/owner/content/asset-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetIds: stagedProcessingIds }),
          cache: "no-store",
          signal,
        });
        if (!res.ok) {
          console.error(
            "[ReplacementSection] staged status poll failed",
            res.status
          );
          return;
        }
        const json = (await res.json()) as { previews?: AssetPreview[] };
        const byId = new Map((json.previews ?? []).map((p) => [p.id, p]));
        setState((current) => {
          if (!current) return current;
          let changed = false;
          const staged = current.staged.map((s) => {
            const fresh = byId.get(s.assetId);
            if (!fresh || fresh.status === s.status) return s;
            changed = true;
            return { ...s, status: fresh.status, errorReason: fresh.errorReason };
          });
          return changed ? { ...current, staged } : current;
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[ReplacementSection] staged status poll error", err);
      }
    },
    [stagedProcessingIds]
  );

  useVisibilityPolling(refreshStagedStatuses, {
    intervalMs: REPLACEMENT_POLL_INTERVAL_MS,
    enabled: open && stagedProcessingIds.length > 0,
  });

  const handlePickFile = () => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  };

  const handleContinue = () => {
    setActionError(null);
    if (!replacementUpload) return;
    if (replacementUpload.needsFile || !retryVideoUpload()) handlePickFile();
  };

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setActionError(null);

    // A pick while paused is a resume — the module's byte-identity check is
    // what stops a different file being spliced onto the offset.
    if (
      replacementUpload?.phase === "paused" &&
      replacementUpload.recoverable
    ) {
      const resumed = resumeVideoUploadWithFile(file);
      if (!resumed.ok) {
        setActionError(resumed.error ?? "Could not continue that upload");
      }
      return;
    }

    if (!targetAssetId) return;
    if (file.size > MAX_VIDEO_BYTES) {
      setActionError("Video is larger than 500 MB.");
      return;
    }

    const started = await startReplacementVideoUpload(
      itemId,
      targetAssetId,
      file
    );
    if (!started.ok) {
      setActionError(started.error ?? "Could not start upload");
      return;
    }
    // The staged row exists from the mint; show it now.
    await load();
  };

  const handleCompare = async (staged: StagedReplacement) => {
    if (comparePending) return;
    setActionError(null);
    setComparePending(true);
    const result = await createReplacementCompareAction(staged.assetId);
    setComparePending(false);
    if (!result.ok || !result.data) {
      setActionError(result.error ?? "Could not start playback");
      return;
    }
    setCompare(result.data);
  };

  const handleConfirmRemove = async () => {
    if (!confirmRemove) return;
    setRemoving(true);
    // Stop the transfer before the delete takes the video it feeds.
    if (replacementUpload?.assetId === confirmRemove.assetId) {
      dismissVideoUpload();
    }
    setCompare(null);
    const result = await deleteContentAssetAction(confirmRemove.assetId);
    setRemoving(false);
    setConfirmRemove(null);
    if (!result.ok) {
      setActionError(result.error ?? "Could not remove the new version");
      return;
    }
    await load();
  };

  if (loadFailed) {
    return (
      <div style={sectionStyle}>
        <p role="alert" style={errorTextStyle}>
          Couldn&apos;t load the replacement.
        </p>
        <button type="button" onClick={() => void load()} style={smallButtonStyle}>
          Try again
        </button>
      </div>
    );
  }

  if (!state) return null;
  // Nothing to replace and nothing staged: a photo post, or a caption-only
  // request. Accepting without a new version is the commit's business
  // (slice 6.2); this section simply has nothing to show.
  if (state.targets.length === 0 && state.staged.length === 0) return null;

  const hasStaged = state.staged.length > 0;

  return (
    <div style={sectionStyle}>
      <p style={headingStyle}>New version</p>

      {/* ---- Start: no staged row yet ---------------------------------- */}
      {!hasStaged && !replacementUpload && (
        <>
          <p style={helperTextStyle}>
            Upload the new version of the video. The client sees nothing
            change until you accept it.
          </p>
          {state.targets.length > 1 && (
            <label style={pickerLabelStyle}>
              Replace
              <select
                value={targetAssetId}
                onChange={(e) => setTargetAssetId(e.target.value)}
                style={pickerSelectStyle}
              >
                {state.targets.map((target) => (
                  <option key={target.assetId} value={target.assetId}>
                    Video {target.position + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={handlePickFile}
            disabled={uploadBlocked}
            style={{
              ...smallButtonStyle,
              opacity: uploadBlocked ? 0.5 : 1,
              cursor: uploadBlocked ? "not-allowed" : "pointer",
            }}
          >
            Upload new version
          </button>
          {uploadBlocked && (
            <p style={mutedTextStyle}>
              A video is uploading elsewhere. Videos upload one at a time.
            </p>
          )}
        </>
      )}

      {/* ---- The upload in flight -------------------------------------- */}
      {replacementUpload && (
        <div style={uploadBoxStyle}>
          {replacementUpload.phase === "paused" ? (
            <>
              <span style={uploadTextStyle}>
                {replacementUpload.needsFile
                  ? replacementUpload.filename
                  : `${replacementUpload.filename} — paused at ${Math.round(
                      replacementUpload.progress * 100
                    )}%`}
              </span>
              {replacementUpload.recoverable ? (
                <button
                  type="button"
                  onClick={handleContinue}
                  style={smallButtonStyle}
                >
                  {replacementUpload.needsFile
                    ? "Pick the file to continue"
                    : "Resume upload"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={dismissVideoUpload}
                  style={smallButtonStyle}
                >
                  Dismiss
                </button>
              )}
            </>
          ) : (
            <>
              <UploadProgressIndicator
                fraction={replacementUpload.progress}
              />
              <span style={uploadTextStyle}>
                {replacementUpload.phase === "finalizing"
                  ? `${replacementUpload.filename} — finishing`
                  : replacementUpload.filename}
              </span>
            </>
          )}
        </div>
      )}

      {/* ---- Staged rows ------------------------------------------------ */}
      {state.staged.map((staged) => {
        const isUploading = replacementUpload?.assetId === staged.assetId;
        if (isUploading) return null; // the upload box above is its readout
        return (
          <div key={staged.assetId} style={stagedRowStyle}>
            {staged.targetAssetId === null ? (
              <span style={uploadTextStyle}>
                The video this was replacing is gone — remove this version.
              </span>
            ) : staged.status === "processing" ? (
              <span style={uploadTextStyle}>
                Processing — the new version is encoding.
              </span>
            ) : staged.status === "failed" ? (
              <span role="alert" style={errorTextStyle}>
                {staged.errorReason ??
                  "Cloudflare couldn't encode this video. Remove it and upload the clip again."}
              </span>
            ) : (
              <span style={uploadTextStyle}>The new version is ready.</span>
            )}
            <div style={stagedActionsStyle}>
              {staged.status === "ready" && staged.targetAssetId !== null && (
                <button
                  type="button"
                  onClick={() => void handleCompare(staged)}
                  disabled={comparePending}
                  style={smallPrimaryButtonStyle}
                >
                  {comparePending ? "Opening…" : "Compare versions"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmRemove(staged)}
                style={smallButtonStyle}
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}

      {/* ---- Side by side ----------------------------------------------- */}
      {compare && (
        <div style={compareBlockStyle}>
          <div style={compareRowStyle}>
            <figure style={compareFigureStyle}>
              <figcaption style={compareCaptionStyle}>Current</figcaption>
              <iframe
                src={compare.currentIframeUrl}
                title="Current version"
                style={compareIframeStyle}
                allow="accelerometer; gyroscope; encrypted-media; picture-in-picture;"
                allowFullScreen
              />
            </figure>
            <figure style={compareFigureStyle}>
              <figcaption style={compareCaptionStyle}>New</figcaption>
              <iframe
                src={compare.newIframeUrl}
                title="New version"
                style={compareIframeStyle}
                allow="accelerometer; gyroscope; encrypted-media; picture-in-picture;"
                allowFullScreen
              />
            </figure>
          </div>
          <button
            type="button"
            onClick={() => setCompare(null)}
            style={smallButtonStyle}
          >
            Close compare
          </button>
        </div>
      )}

      {actionError && (
        <p role="alert" style={errorTextStyle}>
          {actionError}
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileSelected}
        style={{ display: "none" }}
      />

      <ConfirmDialog
        open={confirmRemove !== null}
        title="Remove the new version?"
        body="The uploaded video is deleted from Cloudflare. The client's current video is not touched."
        confirmLabel={removing ? "Removing…" : "Remove"}
        cancelLabel="Keep it"
        variant="danger"
        busy={removing}
        onConfirm={() => void handleConfirmRemove()}
        onCancel={() => {
          if (!removing) setConfirmRemove(null);
        }}
      />
    </div>
  );
}

const sectionStyle: CSSProperties = {
  marginTop: 14,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-body)",
};

const helperTextStyle: CSSProperties = {
  margin: "6px 0 10px",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text-body)",
};

const mutedTextStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 12,
  color: "var(--text-muted)",
};

const errorTextStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--status-danger)",
};

const pickerLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  margin: "0 0 10px",
  fontSize: 13,
  color: "var(--text-body)",
};

const pickerSelectStyle: CSSProperties = {
  minHeight: 48,
  padding: "0 10px",
  fontSize: 16, // iOS focus-zoom floor
  fontFamily: "inherit",
  color: "var(--text-primary)",
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--border)",
};

const smallButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 48,
  padding: "0 14px",
  backgroundColor: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  fontFamily: "inherit",
  cursor: "pointer",
};

const smallPrimaryButtonStyle: CSSProperties = {
  ...smallButtonStyle,
  backgroundColor: "var(--accent)",
  border: "1px solid var(--accent)",
  color: "#FFFFFF",
};

const uploadBoxStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 10,
  marginTop: 10,
};

const uploadTextStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text-body)",
  overflowWrap: "anywhere",
};

const stagedRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginTop: 10,
};

const stagedActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const compareBlockStyle: CSSProperties = {
  marginTop: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const compareRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
};

const compareFigureStyle: CSSProperties = {
  margin: 0,
  flex: "1 1 0",
  minWidth: 0,
};

const compareCaptionStyle: CSSProperties = {
  margin: "0 0 4px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-body)",
};

const compareIframeStyle: CSSProperties = {
  display: "block",
  width: "100%",
  aspectRatio: "9 / 16",
  border: "none",
  backgroundColor: "#132A1C", // --sidebar-deep, matches the player frames
};
