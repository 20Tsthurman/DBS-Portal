"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import { UploadProgressIndicator } from "@/components/ui/UploadProgressIndicator";
import {
  applyFocus,
  clearFocus,
  errorStyle,
  fieldStyle,
  helperStyle,
  labelStyle,
} from "@/app/owner/clients/_components/formStyles";
import type { Platform, PostFormat } from "@/lib/supabase";
import { dateKeyInTimezone } from "@/lib/date";
import {
  createContentAssetUploadUrlAction,
  createContentItemAction,
  deleteContentAssetAction,
  fetchContentAssetPreviewsAction,
  finalizeContentAssetAction,
  updateContentItemAction,
  type AssetPreview,
} from "../_actions";
import {
  FORMAT_OPTIONS,
  PLATFORM_OPTIONS,
  defaultDateForMonth,
  timeInputValueInTimezone,
} from "../_lib/format";
import type { ContentItemWithAssets } from "../_lib/queries";
import {
  dismissVideoUpload,
  getVideoUploadServerSnapshot,
  getVideoUploadSnapshot,
  resumeVideoUploadWithFile,
  retryVideoUpload,
  startVideoUpload,
  subscribeVideoUpload,
  type VideoUploadState,
} from "../_lib/videoUpload";

interface ItemFormPanelProps {
  open: boolean;
  onClose: () => void;
  /** Present = edit; absent = create a new post in `cycleId`. */
  item: ContentItemWithAssets | null;
  cycleId: string | null;
  monthKey: string;
}

interface FormValues {
  date: string;
  time: string;
  platform: Platform;
  format: PostFormat;
  caption: string;
}

const DEFAULT_TIME = "09:00";

// Photos only this phase. Comfortably above any phone or mirrorless still,
// and well under the files feature's 50 MB ceiling, which has to carry video
// deliverables too.
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/**
 * Byte ceiling on a video, mirroring MAX_VIDEO_BYTES in _actions.ts.
 *
 * The server enforces it too — this copy exists only so a mis-picked file is
 * rejected before a tus upload is minted and a carousel slot is claimed.
 */
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/**
 * What a tile says when it has no image.
 *
 * The tile for the video currently uploading reports the UPLOAD, not the
 * row's stored status. The row reads 'processing' from the moment it is
 * minted, so trusting it alone would print "Processing" over a tile whose
 * bytes are visibly still moving, and again over one whose upload has stopped
 * and needs her.
 */
function tileLabel(
  preview: AssetPreview,
  active: VideoUploadState | null
): string {
  if (active && active.assetId === preview.id) {
    if (active.phase === "paused") return "Upload paused";
    if (active.phase === "finalizing") return "Finishing";
    return "Uploading";
  }
  if (preview.kind !== "video") return "Photo unavailable";
  if (preview.status === "failed") return "Video failed";
  if (preview.status === "processing") return "Processing";
  return "Video";
}

function valuesFor(
  item: ContentItemWithAssets | null,
  monthKey: string
): FormValues {
  if (!item) {
    return {
      date: defaultDateForMonth(monthKey),
      time: DEFAULT_TIME,
      platform: "instagram",
      format: "reel",
      caption: "",
    };
  }
  const when = new Date(item.scheduled_for);
  return {
    date: dateKeyInTimezone(when),
    time: timeInputValueInTimezone(when),
    platform: item.platform,
    format: item.format,
    caption: item.caption ?? "",
  };
}

/**
 * XHR rather than `fetch` so real progress events are available — cloned from
 * the files feature's `uploadFileWithProgress`. If the panel closes or the
 * user navigates mid-upload the XHR aborts naturally and finalize is never
 * called, so no orphan row is written.
 */
function uploadFileWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded / event.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    xhr.send(file);
  });
}

export function ItemFormPanel({
  open,
  onClose,
  item,
  cycleId,
  monthKey,
}: ItemFormPanelProps) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() =>
    valuesFor(item, monthKey)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A post must exist before photos can hang off it (content_assets FKs the
  // item). Creating flips this on without closing the panel, so Kelsey saves
  // once and keeps going straight into the photos.
  const [activeItemId, setActiveItemId] = useState<string | null>(
    item?.id ?? null
  );

  const [previews, setPreviews] = useState<AssetPreview[]>([]);
  const [previewsLoading, setPreviewsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [confirmDeleteAsset, setConfirmDeleteAsset] =
    useState<AssetPreview | null>(null);
  const [deletingAsset, setDeletingAsset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * The video upload lives in module scope, not in this component. It has to
   * outlive the panel: closing it, tapping another post, or navigating to
   * another owner page all unmount this tree, and any upload held in React
   * state would die mid-file with it. The panel is a subscriber here, never
   * the owner.
   */
  const uploadSnapshot = useSyncExternalStore(
    subscribeVideoUpload,
    getVideoUploadSnapshot,
    getVideoUploadServerSnapshot
  );

  /** The upload only renders in the panel for the item it belongs to. */
  const videoUpload =
    uploadSnapshot.active && uploadSnapshot.active.itemId === activeItemId
      ? uploadSnapshot.active
      : null;

  // One video at a time, including one belonging to a different post — that
  // is the module's rule, and disabling the button says so before she picks a
  // file and gets an error back.
  const addVideoDisabled = uploading || uploadSnapshot.active !== null;

  const loadPreviews = useCallback(async (itemId: string) => {
    setPreviewsLoading(true);
    const result = await fetchContentAssetPreviewsAction(itemId);
    setPreviewsLoading(false);
    if (!result.ok || !result.data) {
      setMediaError(result.error ?? "Could not load media");
      return;
    }
    setPreviews(result.data);
  }, []);

  useEffect(() => {
    if (!open) return;
    setValues(valuesFor(item, monthKey));
    setActiveItemId(item?.id ?? null);
    setError(null);
    setMediaError(null);
    setPreviews([]);
    setUploadProgress(0);
    if (item) void loadPreviews(item.id);
  }, [open, item, monthKey, loadPreviews]);

  /**
   * Completion is observed as a counter rather than a callback, because the
   * panel instance that started an upload is frequently not the one still
   * mounted when it finishes.
   */
  const seenCompletions = useRef(uploadSnapshot.completions);
  useEffect(() => {
    if (uploadSnapshot.completions === seenCompletions.current) return;
    seenCompletions.current = uploadSnapshot.completions;
    if (!activeItemId) return;
    void loadPreviews(activeItemId);
    router.refresh();
  }, [uploadSnapshot.completions, activeItemId, loadPreviews, router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    const payload = {
      date: values.date,
      time: values.time,
      platform: values.platform,
      format: values.format,
      caption: values.caption,
    };

    const result = activeItemId
      ? await updateContentItemAction({ itemId: activeItemId, ...payload })
      : await createContentItemAction({ cycleId: cycleId ?? "", ...payload });
    setSubmitting(false);

    if (!result.ok || !result.data) {
      setError(result.error ?? "Could not save post.");
      return;
    }

    if (!activeItemId) {
      // Stay open so photos can be added to the post that was just created.
      setActiveItemId(result.data.id);
      router.refresh();
      return;
    }
    onClose();
    router.refresh();
  };

  const handlePickPhoto = () => {
    if (!fileInputRef.current) return;
    // Reset first so re-picking the same file still fires `change`.
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  };

  const handlePhotoSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !activeItemId || uploading) return;

    setMediaError(null);
    if (file.size > MAX_PHOTO_BYTES) {
      setMediaError("Photo is larger than 25 MB.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    const urlResult = await createContentAssetUploadUrlAction({
      itemId: activeItemId,
      filename: file.name,
    });
    if (!urlResult.ok || !urlResult.data) {
      setUploading(false);
      setMediaError(urlResult.error ?? "Could not start upload");
      return;
    }

    const { signedUrl, storagePath } = urlResult.data;
    try {
      await uploadFileWithProgress(signedUrl, file, setUploadProgress);
    } catch (err) {
      setUploading(false);
      setMediaError(err instanceof Error ? err.message : "Upload failed");
      return;
    }

    // Snap to 100% so the UI flips to "Finalizing…" even when the last
    // progress tick lands below 1.0.
    setUploadProgress(1);

    const finalizeResult = await finalizeContentAssetAction({
      itemId: activeItemId,
      storagePath,
    });
    setUploading(false);

    if (!finalizeResult.ok) {
      setMediaError(finalizeResult.error ?? "Failed to save photo");
      return;
    }

    await loadPreviews(activeItemId);
    router.refresh();
  };

  const handlePickVideo = () => {
    if (!videoInputRef.current) return;
    // Reset first so re-picking the same file still fires `change` — which is
    // exactly what a resume is.
    videoInputRef.current.value = "";
    videoInputRef.current.click();
  };

  const handleContinueVideo = () => {
    setMediaError(null);
    if (!videoUpload) return;
    // After a reload the File is gone and only she can supply it again; tus
    // then HEADs the saved upload URL and sends only the missing tail.
    if (videoUpload.needsFile || !retryVideoUpload()) handlePickVideo();
  };

  const handleVideoSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file || !activeItemId) return;
    setMediaError(null);

    // Any pick made while an upload is paused is a RESUME, not a new upload —
    // including one reached through "Resume upload" after the in-memory File
    // was lost. The module refuses it unless the file is byte-for-byte the
    // same one: tus resumes at an offset and asks nothing about what is on
    // the other side of it, so a different file would splice two videos
    // together into something that uploads and encodes without any error.
    if (videoUpload?.phase === "paused" && videoUpload.recoverable) {
      const resumed = resumeVideoUploadWithFile(file);
      if (!resumed.ok) {
        setMediaError(resumed.error ?? "Could not continue that upload");
      }
      return;
    }

    if (file.size > MAX_VIDEO_BYTES) {
      setMediaError("Video is larger than 500 MB.");
      return;
    }

    const started = await startVideoUpload(activeItemId, file);
    if (!started.ok) {
      setMediaError(started.error ?? "Could not start upload");
      return;
    }

    // The row exists from the mint, so its tile can appear now rather than
    // only once the upload finishes.
    await loadPreviews(activeItemId);
    router.refresh();
  };

  const handleConfirmDeleteAsset = async () => {
    if (!confirmDeleteAsset || !activeItemId) return;
    setDeletingAsset(true);
    // Stop the transfer before the row goes. The delete action removes the
    // Stream video itself, so anything still pushing bytes at it is pushing
    // at something about to stop existing.
    if (videoUpload?.assetId === confirmDeleteAsset.id) {
      dismissVideoUpload();
    }
    const result = await deleteContentAssetAction(confirmDeleteAsset.id);
    setDeletingAsset(false);
    if (!result.ok) {
      setMediaError(result.error ?? "Could not delete photo");
      setConfirmDeleteAsset(null);
      return;
    }
    setConfirmDeleteAsset(null);
    await loadPreviews(activeItemId);
    router.refresh();
  };

  const isCarousel = values.format === "carousel";

  return (
    <>
      <SlidePanel
        open={open}
        onClose={onClose}
        title={activeItemId ? "Edit post" : "New post"}
        widthPx={520}
      >
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <div className="flex-1 space-y-5">
            <div className="flex gap-4">
              <div style={{ flex: 1 }}>
                <label htmlFor="item-date" style={labelStyle}>
                  Date
                </label>
                <input
                  id="item-date"
                  type="date"
                  required
                  value={values.date}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, date: e.target.value }))
                  }
                  onFocus={applyFocus}
                  onBlur={clearFocus}
                  style={fieldStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="item-time" style={labelStyle}>
                  Time
                </label>
                <input
                  id="item-time"
                  type="time"
                  required
                  value={values.time}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, time: e.target.value }))
                  }
                  onFocus={applyFocus}
                  onBlur={clearFocus}
                  style={fieldStyle}
                />
              </div>
            </div>
            <p style={{ ...helperStyle, marginTop: -12 }}>
              Central time. Must fall inside the cycle&apos;s month.
            </p>

            <div className="flex gap-4">
              <div style={{ flex: 1 }}>
                <label htmlFor="item-platform" style={labelStyle}>
                  Platform
                </label>
                <select
                  id="item-platform"
                  value={values.platform}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      platform: e.target.value as Platform,
                    }))
                  }
                  onFocus={applyFocus}
                  onBlur={clearFocus}
                  style={fieldStyle}
                >
                  {PLATFORM_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="item-format" style={labelStyle}>
                  Format
                </label>
                <select
                  id="item-format"
                  value={values.format}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      format: e.target.value as PostFormat,
                    }))
                  }
                  onFocus={applyFocus}
                  onBlur={clearFocus}
                  style={fieldStyle}
                >
                  {FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="item-caption" style={labelStyle}>
                Caption
              </label>
              <textarea
                id="item-caption"
                rows={5}
                value={values.caption}
                onChange={(e) =>
                  setValues((v) => ({ ...v, caption: e.target.value }))
                }
                onFocus={applyFocus}
                onBlur={clearFocus}
                style={{ ...fieldStyle, minHeight: 120, resize: "vertical" }}
              />
            </div>

            {error && (
              <div role="alert" style={errorStyle}>
                {error}
              </div>
            )}

            <div style={mediaSectionStyle}>
              <span style={labelStyle}>Media</span>
              {!activeItemId ? (
                <p style={helperStyle}>
                  Save the post first — media attaches to it once it exists.
                </p>
              ) : (
                <>
                  <p style={helperStyle}>
                    {isCarousel
                      ? "Carousel: media plays in the order shown below."
                      : "Photos and video attach here in the order shown below."}
                  </p>

                  {previewsLoading && previews.length === 0 && (
                    <p style={mutedNoteStyle}>Loading media…</p>
                  )}

                  {previews.length > 0 && (
                    <div style={thumbGridStyle}>
                      {previews.map((preview, index) => (
                        <figure key={preview.id} style={thumbFigureStyle}>
                          {preview.url ? (
                            /* Plain <img>: these are short-lived signed URLs
                               against a private bucket, so the Image optimizer
                               has no stable host to whitelist. */
                            <img
                              src={preview.url}
                              alt={`Photo ${index + 1}`}
                              style={thumbImgStyle}
                            />
                          ) : (
                            /* Nothing to show as an image: a Stream video has
                               no thumbnail until the playback surface lands in
                               2.4, and a photo whose object went missing has
                               none at all. The tile is still rendered either
                               way. Omitting it would make an uploaded video
                               invisible while its row holds a carousel slot,
                               which reads as a lost upload and invites a
                               second one into a position already taken. */
                            <div
                              role="img"
                              aria-label={`${tileLabel(preview, videoUpload)}, position ${index + 1}`}
                              style={thumbPlaceholderStyle}
                            >
                              <span aria-hidden="true" style={placeholderMarkStyle}>
                                {preview.kind === "video" ? "▶" : "!"}
                              </span>
                              <span style={placeholderTextStyle}>
                                {tileLabel(preview, videoUpload)}
                              </span>
                            </div>
                          )}
                          <figcaption style={thumbCaptionStyle}>
                            <span>#{index + 1}</span>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteAsset(preview)}
                              style={thumbDeleteStyle}
                            >
                              Remove
                            </button>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}

                  {uploading && (
                    <p style={mutedNoteStyle}>
                      {uploadProgress >= 1
                        ? "Finalizing…"
                        : `Uploading ${Math.round(uploadProgress * 100)}%`}
                    </p>
                  )}

                  {videoUpload && (
                    <div style={videoStatusStyle}>
                      {videoUpload.phase === "paused" ? (
                        <>
                          <span style={videoStatusTextStyle}>
                            {videoUpload.needsFile
                              ? videoUpload.filename
                              : `${videoUpload.filename} — paused at ${Math.round(
                                  videoUpload.progress * 100
                                )}%`}
                          </span>
                          {videoUpload.recoverable ? (
                            <button
                              type="button"
                              onClick={handleContinueVideo}
                              style={addMediaStyle}
                            >
                              {videoUpload.needsFile
                                ? "Pick the file to continue"
                                : "Resume upload"}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={dismissVideoUpload}
                              style={addMediaStyle}
                            >
                              Dismiss
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <UploadProgressIndicator
                            fraction={videoUpload.progress}
                          />
                          <span style={videoStatusTextStyle}>
                            {videoUpload.filename}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Otherwise "Add video" is disabled with no reason on
                      screen — the upload she is waiting on is on a different
                      post, so nothing above accounts for it. */}
                  {!videoUpload && uploadSnapshot.active && (
                    <p style={mutedNoteStyle}>
                      A video is uploading on another post. Videos upload one at
                      a time.
                    </p>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoSelected}
                    style={{ display: "none" }}
                  />
                  <input
                    ref={videoInputRef}
                    type="file"
                    accept="video/*"
                    onChange={handleVideoSelected}
                    style={{ display: "none" }}
                  />

                  <div style={mediaActionsStyle}>
                    <button
                      type="button"
                      onClick={handlePickPhoto}
                      disabled={uploading}
                      style={{
                        ...addMediaStyle,
                        opacity: uploading ? 0.6 : 1,
                        cursor: uploading ? "not-allowed" : "pointer",
                      }}
                    >
                      Add photo
                    </button>
                    <button
                      type="button"
                      onClick={handlePickVideo}
                      disabled={addVideoDisabled}
                      style={{
                        ...addMediaStyle,
                        opacity: addVideoDisabled ? 0.6 : 1,
                        cursor: addVideoDisabled ? "not-allowed" : "pointer",
                      }}
                    >
                      Add video
                    </button>
                  </div>

                  {/* Says exactly what the platform does and nothing more.
                      There is no background upload API in Safari: a closed
                      tab, a reload, or a backgrounded app on iPhone stops the
                      transfer. What survives is the byte offset. */}
                  <p style={mutedNoteStyle}>
                    Video uploads pick up where they stopped. They only move
                    while this screen is open — closing the tab, reloading, or
                    switching apps on a phone pauses the upload until you come
                    back to it.
                  </p>

                  {(mediaError || videoUpload?.error) && (
                    <div role="alert" style={errorStyle}>
                      {mediaError ?? videoUpload?.error}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div style={footerStyle}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={cancelStyle}
            >
              {activeItemId ? "Done" : "Cancel"}
            </button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? "Saving…"
                : activeItemId
                  ? "Save changes"
                  : "Create post"}
            </Button>
          </div>
        </form>
      </SlidePanel>

      <ConfirmDialog
        open={confirmDeleteAsset !== null}
        onCancel={() => {
          if (deletingAsset) return;
          setConfirmDeleteAsset(null);
        }}
        onConfirm={handleConfirmDeleteAsset}
        title={
          confirmDeleteAsset?.kind === "video"
            ? "Remove video?"
            : "Remove photo?"
        }
        body={
          confirmDeleteAsset?.kind === "video"
            ? "The video is deleted from Cloudflare Stream — including one that is still uploading or still processing. This can't be undone."
            : "The photo is deleted from storage. This can't be undone."
        }
        confirmLabel="Remove"
        variant="danger"
        busy={deletingAsset}
      />
    </>
  );
}

const mediaSectionStyle: CSSProperties = {
  paddingTop: 20,
  borderTop: "1px solid var(--border)",
};

const thumbGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
  gap: 10,
  margin: "12px 0",
};

const thumbFigureStyle: CSSProperties = {
  margin: 0,
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
};

// 9:16 vertical throughout, never cropped to square (spec §3.9).
const thumbImgStyle: CSSProperties = {
  display: "block",
  width: "100%",
  aspectRatio: "9 / 16",
  objectFit: "cover",
};

const thumbCaptionStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 4,
  padding: "4px 6px",
  fontSize: 11,
  color: "var(--text-muted)",
};

const thumbDeleteStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--status-danger)",
  cursor: "pointer",
};

const mutedNoteStyle: CSSProperties = {
  margin: "8px 0",
  fontSize: 12,
  color: "var(--text-muted)",
};

const addMediaStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  minHeight: 44,
  padding: "0 16px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--accent)",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 12,
  marginTop: 24,
  paddingTop: 16,
  borderTop: "1px solid var(--border)",
};

const thumbPlaceholderStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  // Matches thumbImgStyle exactly so a video tile and a photo tile are the
  // same size in the grid (9:16 vertical throughout, spec §3.9).
  aspectRatio: "9 / 16",
  backgroundColor: "var(--surface-sunken, var(--surface-raised))",
  color: "var(--text-muted)",
  textAlign: "center",
  padding: 6,
};

const placeholderMarkStyle: CSSProperties = {
  fontSize: 18,
  lineHeight: 1,
  opacity: 0.7,
};

const placeholderTextStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const videoStatusStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  margin: "8px 0",
};

const videoStatusTextStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};

const mediaActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const cancelStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  minHeight: 44,
  padding: "0 8px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-body)",
  cursor: "pointer",
};
