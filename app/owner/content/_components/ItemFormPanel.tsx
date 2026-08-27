"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
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
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [confirmDeleteAsset, setConfirmDeleteAsset] =
    useState<AssetPreview | null>(null);
  const [deletingAsset, setDeletingAsset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadPreviews = useCallback(async (itemId: string) => {
    setPreviewsLoading(true);
    const result = await fetchContentAssetPreviewsAction(itemId);
    setPreviewsLoading(false);
    if (!result.ok || !result.data) {
      setPhotoError(result.error ?? "Could not load photos");
      return;
    }
    setPreviews(result.data);
  }, []);

  useEffect(() => {
    if (!open) return;
    setValues(valuesFor(item, monthKey));
    setActiveItemId(item?.id ?? null);
    setError(null);
    setPhotoError(null);
    setPreviews([]);
    setUploadProgress(0);
    if (item) void loadPreviews(item.id);
  }, [open, item, monthKey, loadPreviews]);

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

    setPhotoError(null);
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError("Photo is larger than 25 MB.");
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
      setPhotoError(urlResult.error ?? "Could not start upload");
      return;
    }

    const { signedUrl, storagePath } = urlResult.data;
    try {
      await uploadFileWithProgress(signedUrl, file, setUploadProgress);
    } catch (err) {
      setUploading(false);
      setPhotoError(err instanceof Error ? err.message : "Upload failed");
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
      setPhotoError(finalizeResult.error ?? "Failed to save photo");
      return;
    }

    await loadPreviews(activeItemId);
    router.refresh();
  };

  const handleConfirmDeleteAsset = async () => {
    if (!confirmDeleteAsset || !activeItemId) return;
    setDeletingAsset(true);
    const result = await deleteContentAssetAction(confirmDeleteAsset.id);
    setDeletingAsset(false);
    if (!result.ok) {
      setPhotoError(result.error ?? "Could not delete photo");
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

            <div style={photoSectionStyle}>
              <span style={labelStyle}>Photos</span>
              {!activeItemId ? (
                <p style={helperStyle}>
                  Save the post first — photos attach to it once it exists.
                </p>
              ) : (
                <>
                  <p style={helperStyle}>
                    {isCarousel
                      ? "Carousel: photos play in the order shown below."
                      : "Video comes in a later phase — photos only for now."}
                  </p>

                  {previewsLoading && previews.length === 0 && (
                    <p style={mutedNoteStyle}>Loading photos…</p>
                  )}

                  {previews.length > 0 && (
                    <div style={thumbGridStyle}>
                      {previews.map((preview, index) => (
                        <figure key={preview.id} style={thumbFigureStyle}>
                          {/* Plain <img>: these are short-lived signed URLs
                              against a private bucket, so the Image optimizer
                              has no stable host to whitelist. */}
                          <img
                            src={preview.url}
                            alt={`Photo ${index + 1}`}
                            style={thumbImgStyle}
                          />
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

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoSelected}
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    onClick={handlePickPhoto}
                    disabled={uploading}
                    style={{
                      ...addPhotoStyle,
                      opacity: uploading ? 0.6 : 1,
                      cursor: uploading ? "not-allowed" : "pointer",
                    }}
                  >
                    Add photo
                  </button>

                  {photoError && (
                    <div role="alert" style={errorStyle}>
                      {photoError}
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
        title="Remove photo?"
        body="The photo is deleted from storage. This can't be undone."
        confirmLabel="Remove"
        variant="danger"
        busy={deletingAsset}
      />
    </>
  );
}

const photoSectionStyle: CSSProperties = {
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

const addPhotoStyle: CSSProperties = {
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
