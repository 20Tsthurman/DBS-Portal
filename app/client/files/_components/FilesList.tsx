"use client";

import { useState, type CSSProperties } from "react";
import { formatDate } from "@/app/owner/clients/_lib/format";
import type { FileRecord } from "@/lib/supabase";
import { createFileDownloadUrlAction } from "../_actions";

interface FilesListProps {
  files: FileRecord[];
}

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

export function FilesList({ files }: FilesListProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deliverables = files.filter((f) => f.file_type === "content");
  const references = files.filter((f) => f.file_type !== "content");

  const handleDownload = async (fileId: string) => {
    setError(null);
    setDownloadingId(fileId);
    const res = await createFileDownloadUrlAction({ fileId });
    setDownloadingId(null);
    if (!res.ok || !res.data) {
      setError(res.error ?? "Could not generate link");
      return;
    }
    window.open(res.data.signedUrl, "_blank", "noopener,noreferrer");
  };

  if (files.length === 0) {
    return (
      <div style={emptyStateStyle}>
        No files yet. Kelsey will share files with you here once they&apos;re
        ready.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {deliverables.length > 0 && (
        <Section
          title="Deliverables"
          files={deliverables}
          downloadingId={downloadingId}
          onDownload={handleDownload}
        />
      )}
      {references.length > 0 && (
        <Section
          title="References"
          files={references}
          downloadingId={downloadingId}
          onDownload={handleDownload}
        />
      )}
      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  files: FileRecord[];
  downloadingId: string | null;
  onDownload: (fileId: string) => void;
}

function Section({ title, files, downloadingId, onDownload }: SectionProps) {
  return (
    <section>
      <h2 style={sectionTitleStyle}>{title}</h2>
      <div
        style={{
          border: "1px solid var(--border)",
          backgroundColor: "var(--surface-raised)",
        }}
      >
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {files.map((file, idx) => (
            <li
              key={file.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 18px",
                borderTop: idx === 0 ? "none" : "1px solid var(--border)",
                gap: 16,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {file.name}
                </p>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  {formatBytes(file.size_bytes)} · {formatDate(file.uploaded_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDownload(file.id)}
                disabled={downloadingId === file.id}
                style={{
                  ...downloadButtonStyle,
                  opacity: downloadingId === file.id ? 0.6 : 1,
                  cursor:
                    downloadingId === file.id ? "not-allowed" : "pointer",
                }}
              >
                {downloadingId === file.id ? "Opening…" : "Download"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const sectionTitleStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 22,
  fontWeight: 500,
  color: "var(--text-primary)",
  letterSpacing: "-0.01em",
  margin: "0 0 12px",
};

const emptyStateStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "var(--surface-raised)",
  padding: "48px 24px",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 14,
};

const downloadButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "1px solid var(--accent)",
  fontFamily: "inherit",
};

const errorStyle: CSSProperties = {
  color: "var(--status-danger)",
  fontSize: 13,
};
