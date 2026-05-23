"use client";

import {
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  MobileCard,
  MobileCardActions,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/ui/MobileCard";
import { formatDate } from "@/app/owner/clients/_lib/format";
import type { FileRecord } from "@/lib/supabase";
import {
  createFileUploadUrlAction,
  createOwnerFileDownloadUrlAction,
  deleteFileAction,
  finalizeFileUploadAction,
} from "../_actions";

interface FilesPanelProps {
  clientId: string;
  clientName: string;
  files: FileRecord[];
}

/**
 * XHR-based upload so we can surface real progress events — `fetch` does
 * not expose `upload.progress`. Resolves on 2xx, rejects otherwise; the
 * caller's existing error path catches the rejection.
 *
 * If the user navigates away mid-upload, the XHR aborts naturally and
 * `finalizeFileUploadAction` is never called, so no orphan row is
 * written. Cancel-during-upload is intentionally not exposed.
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
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    xhr.send(file);
  });
}

type UiFileType = "content" | "other";

const FILE_TYPE_OPTIONS: Array<{ value: UiFileType; label: string }> = [
  { value: "content", label: "Content" },
  { value: "other", label: "Other" },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return "<1 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Split a filename into its basename + extension at the LAST dot.
 * Leading-dot files (".env") are treated as having no extension so the
 * display-name input pre-fills with something the user can edit. The
 * returned `ext` is the substring after the dot only (no leading dot),
 * matching the join format used in `handleUpload`.
 */
function splitFilename(filename: string): { base: string; ext: string } {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return { base: filename, ext: "" };
  return {
    base: filename.slice(0, lastDot),
    ext: filename.slice(lastDot + 1),
  };
}

function fileTypeLabel(type: FileRecord["file_type"]): string {
  switch (type) {
    case "content":
      return "Content";
    case "other":
      return "Other";
    case "contract":
      return "Contract";
    case "invoice":
      return "Invoice";
  }
}

function fileTypeTone(
  type: FileRecord["file_type"]
): "accent" | "neutral" {
  return type === "content" ? "accent" : "neutral";
}

export function FilesPanel({ clientId, clientName, files }: FilesPanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [fileType, setFileType] = useState<UiFileType>("content");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletePending, startDeleteTransition] = useTransition();

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const confirmingFile = confirmDeleteId
    ? files.find((f) => f.id === confirmDeleteId) ?? null
    : null;

  const resetForm = () => {
    setPickedFile(null);
    setDisplayName("");
    setFileType("content");
    setUploadError(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenForm = () => {
    setFormOpen(true);
    setUploadError(null);
  };

  const handleCancelForm = () => {
    if (uploading) return;
    setFormOpen(false);
    resetForm();
  };

  const handlePickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setPickedFile(next);
    setDisplayName(next ? splitFilename(next.name).base : "");
    setUploadError(null);
  };

  const handleReplace = () => {
    if (uploading) return;
    setPickedFile(null);
    setDisplayName("");
    setUploadError(null);
    if (fileInputRef.current) {
      // Reset the value first so picking the same file again still fires
      // change. The input is hidden via display:none while a file is
      // selected; programmatic click still opens the OS picker.
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleUpload = async () => {
    if (!pickedFile || uploading) return;
    if (pickedFile.size > MAX_UPLOAD_BYTES) return;
    const trimmedDisplay = displayName.trim();
    if (!trimmedDisplay) return;

    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);

    const originalFilename = pickedFile.name;
    const filePicked = pickedFile;
    const typePicked = fileType;
    const { ext } = splitFilename(originalFilename);
    const displayNameWithExtension = ext
      ? `${trimmedDisplay}.${ext}`
      : trimmedDisplay;

    // Storage path stays derived from the original (sanitized) filename
    // so two files renamed to the same display name don't collide and
    // exotic characters in the display name don't end up as storage keys.
    const urlResult = await createFileUploadUrlAction({
      clientId,
      filename: originalFilename,
    });
    if (!urlResult.ok || !urlResult.data) {
      setUploading(false);
      setUploadError(urlResult.error ?? "Could not start upload");
      return;
    }

    const { signedUrl, storagePath } = urlResult.data;

    try {
      await uploadFileWithProgress(signedUrl, filePicked, setUploadProgress);
    } catch (err) {
      setUploading(false);
      setUploadError(err instanceof Error ? err.message : "Upload failed");
      return;
    }

    // Snap to 100% so the UI flips into the "Finalizing…" state even if
    // the last `progress` event came in below 1.0 (Supabase Storage
    // sometimes elides the final tick).
    setUploadProgress(1);

    const finalizeResult = await finalizeFileUploadAction({
      clientId,
      storagePath,
      filename: displayNameWithExtension,
      fileType: typePicked,
    });

    setUploading(false);
    if (!finalizeResult.ok) {
      setUploadError(finalizeResult.error ?? "Failed to save file");
      return;
    }

    setFormOpen(false);
    resetForm();
    router.refresh();
  };

  const handleRequestDelete = (fileId: string) => {
    setDeleteError(null);
    setConfirmDeleteId(fileId);
  };

  const handleCancelDelete = () => {
    if (isDeletePending) return;
    setConfirmDeleteId(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = () => {
    if (!confirmDeleteId) return;
    setDeleteError(null);
    const idToDelete = confirmDeleteId;
    startDeleteTransition(async () => {
      const res = await deleteFileAction({ fileId: idToDelete });
      if (!res.ok) {
        setDeleteError(res.error ?? "Delete failed");
        return;
      }
      setConfirmDeleteId(null);
      router.refresh();
    });
  };

  const handleDownload = async (fileId: string) => {
    setDownloadError(null);
    setDownloadingId(fileId);
    const res = await createOwnerFileDownloadUrlAction({ fileId });
    setDownloadingId(null);
    if (!res.ok || !res.data) {
      setDownloadError(res.error ?? "Could not generate link");
      return;
    }
    window.open(res.data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
      }}
    >
      <header
        className="flex flex-col items-stretch gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4"
        style={{
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 600,
              color: "var(--text-muted)",
              margin: 0,
            }}
          >
            Files
          </p>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 13,
              color: "var(--text-body)",
            }}
          >
            {files.length === 0
              ? "Nothing shared yet."
              : `${files.length} file${files.length === 1 ? "" : "s"} shared`}
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={handleOpenForm}
            className="w-full min-h-[44px] lg:w-auto lg:min-h-0"
            style={primaryButtonStyle}
          >
            Upload File
          </button>
        )}
      </header>

      {formOpen && (() => {
        const split = pickedFile ? splitFilename(pickedFile.name) : null;
        const extension = split?.ext ?? "";
        const trimmedDisplay = displayName.trim();
        const tooLarge = pickedFile
          ? pickedFile.size > MAX_UPLOAD_BYTES
          : false;
        const nameMissing = pickedFile !== null && trimmedDisplay.length === 0;
        const canUpload =
          pickedFile !== null && !tooLarge && !nameMissing;

        return (
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border)",
              backgroundColor: "var(--surface-base)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-end",
                gap: 16,
              }}
            >
              {/* The native input stays mounted with a stable ref so
                * `handleReplace` can re-trigger the OS picker; it just
                * hides when a file is already selected. */}
              <label
                style={{
                  ...fieldStyle,
                  display: pickedFile ? "none" : undefined,
                }}
              >
                <span style={fieldLabelStyle}>File</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handlePickFile}
                  disabled={uploading}
                  style={{ fontSize: 13 }}
                />
              </label>

              {pickedFile && (
                <>
                  <div style={fieldStyle}>
                    <span style={fieldLabelStyle}>File</span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 12,
                        minHeight: 32,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          color: "var(--text-body)",
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={pickedFile.name}
                      >
                        {pickedFile.name}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--text-muted)",
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatBytes(pickedFile.size)}
                      </span>
                      <button
                        type="button"
                        onClick={handleReplace}
                        disabled={uploading}
                        style={{
                          ...tertiaryButtonStyle,
                          opacity: uploading ? 0.6 : 1,
                          cursor: uploading ? "not-allowed" : "pointer",
                        }}
                      >
                        Replace
                      </button>
                    </div>
                  </div>

                  <label style={fieldStyle}>
                    <span style={fieldLabelStyle}>Display name</span>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        disabled={uploading}
                        style={{ ...inputStyle, width: 220 }}
                      />
                      {extension && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 13,
                            color: "var(--text-muted)",
                          }}
                        >
                          .{extension}
                        </span>
                      )}
                    </div>
                  </label>
                </>
              )}

              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Type</span>
                <select
                  value={fileType}
                  onChange={(e) => setFileType(e.target.value as UiFileType)}
                  disabled={uploading}
                  style={selectStyle}
                >
                  {FILE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {uploading ? (
                  <UploadProgressIndicator fraction={uploadProgress} />
                ) : (
                  <button
                    type="button"
                    onClick={handleUpload}
                    disabled={!canUpload}
                    style={{
                      ...primaryButtonStyle,
                      opacity: !canUpload ? 0.6 : 1,
                      cursor: !canUpload ? "not-allowed" : "pointer",
                    }}
                  >
                    Upload
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCancelForm}
                  disabled={uploading}
                  style={{
                    ...secondaryButtonStyle,
                    opacity: uploading ? 0.6 : 1,
                    cursor: uploading ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>

            {tooLarge && (
              <div role="alert" style={errorStyle}>
                File exceeds 50 MB limit. Try a smaller file.
              </div>
            )}
            {!tooLarge && nameMissing && (
              <div role="alert" style={errorStyle}>
                Display name required.
              </div>
            )}
            {uploadError && (
              <div role="alert" style={errorStyle}>
                {uploadError}
              </div>
            )}
          </div>
        );
      })()}

      {files.length === 0 ? (
        <div
          style={{
            padding: "48px 20px",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          No files yet. Upload a file to share it with {clientName}.
        </div>
      ) : (
        <>
          <table className="hidden lg:table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Type</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>By</th>
                <th style={{ textAlign: "right" }} aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {file.name}
                  </td>
                  <td>
                    <StatusPill tone={fileTypeTone(file.file_type)}>
                      {fileTypeLabel(file.file_type)}
                    </StatusPill>
                  </td>
                  <td>{formatBytes(file.size_bytes)}</td>
                  <td>{formatDate(file.uploaded_at)}</td>
                  <td>{file.uploaded_by}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      onClick={() => handleDownload(file.id)}
                      disabled={downloadingId === file.id}
                      style={{
                        ...rowActionStyle,
                        opacity: downloadingId === file.id ? 0.6 : 1,
                        cursor:
                          downloadingId === file.id ? "not-allowed" : "pointer",
                      }}
                    >
                      {downloadingId === file.id ? "Opening…" : "Download"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRequestDelete(file.id)}
                      style={{
                        ...rowActionStyle,
                        color: "var(--status-danger)",
                        marginLeft: 4,
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <MobileCardList className="p-4 lg:hidden">
            {files.map((file) => (
              <MobileCard key={file.id}>
                <MobileCardHeader
                  title={file.name}
                  badge={
                    <StatusPill tone={fileTypeTone(file.file_type)}>
                      {fileTypeLabel(file.file_type)}
                    </StatusPill>
                  }
                />
                <MobileCardField label="Size">
                  {formatBytes(file.size_bytes)}
                </MobileCardField>
                <MobileCardField label="Uploaded">
                  {formatDate(file.uploaded_at)}
                </MobileCardField>
                <MobileCardField label="By">{file.uploaded_by}</MobileCardField>
                <MobileCardActions>
                  <button
                    type="button"
                    onClick={() => handleDownload(file.id)}
                    disabled={downloadingId === file.id}
                    style={{
                      ...rowActionStyle,
                      opacity: downloadingId === file.id ? 0.6 : 1,
                      cursor:
                        downloadingId === file.id ? "not-allowed" : "pointer",
                    }}
                  >
                    {downloadingId === file.id ? "Opening…" : "Download"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRequestDelete(file.id)}
                    style={{
                      ...rowActionStyle,
                      color: "var(--status-danger)",
                    }}
                  >
                    Delete
                  </button>
                </MobileCardActions>
              </MobileCard>
            ))}
          </MobileCardList>
        </>
      )}

      {downloadError && (
        <div role="alert" style={{ ...errorStyle, margin: "12px 20px" }}>
          {downloadError}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete file?"
        body={
          <>
            {confirmingFile
              ? `"${confirmingFile.name}" will be removed permanently and can no longer be downloaded by ${clientName}.`
              : "This file will be removed permanently."}
            {deleteError && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  color: "var(--status-danger)",
                  fontSize: 13,
                }}
              >
                {deleteError}
              </div>
            )}
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        busy={isDeletePending}
      />
    </div>
  );
}

const RING_RADIUS = 12;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function UploadProgressIndicator({ fraction }: { fraction: number }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const finalizing = clamped >= 1;

  if (finalizing) {
    return (
      <span
        role="status"
        aria-live="polite"
        style={{ fontSize: 12, color: "var(--text-body)" }}
      >
        Finalizing…
      </span>
    );
  }

  const percent = Math.round(clamped * 100);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Uploading, ${percent} percent complete`}
      style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
    >
      <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden="true">
        <circle
          cx={14}
          cy={14}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--text-muted)"
          strokeOpacity={0.15}
          strokeWidth={2}
        />
        <circle
          cx={14}
          cy={14}
          r={RING_RADIUS}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped)}
          strokeLinecap="round"
          transform="rotate(-90 14 14)"
          style={{ transition: "stroke-dashoffset 120ms linear" }}
        />
      </svg>
      <span
        style={{
          fontSize: 12,
          color: "var(--text-body)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {percent}%
      </span>
    </div>
  );
}

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 18px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "1px solid var(--accent)",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 18px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "transparent",
  color: "var(--text-body)",
  border: "1px solid var(--border)",
  cursor: "pointer",
};

const rowActionStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: "4px 8px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--accent)",
  cursor: "pointer",
};

const tertiaryButtonStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--accent)",
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  color: "var(--text-primary)",
  fontFamily: "inherit",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "var(--text-muted)",
};

const selectStyle: CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  color: "var(--text-primary)",
  fontFamily: "inherit",
};

const errorStyle: CSSProperties = {
  color: "var(--status-danger)",
  fontSize: 13,
};
