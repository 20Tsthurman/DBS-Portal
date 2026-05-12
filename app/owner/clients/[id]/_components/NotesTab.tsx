"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateNotesAction } from "../../_actions";
import {
  applyFocus,
  clearFocus,
  fieldStyle,
} from "../../_components/formStyles";

interface NotesTabProps {
  clientId: string;
  initialNotes: string;
  initialSavedAt: string | null;
}

function formatSavedAt(iso: string | null): string {
  if (!iso) return "Not saved yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not saved yet";
  return `Last saved ${date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function NotesTab({
  clientId,
  initialNotes,
  initialSavedAt,
}: NotesTabProps) {
  const [value, setValue] = useState(initialNotes);
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAt);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastSavedValue = useRef(initialNotes);

  useEffect(() => {
    setValue(initialNotes);
    lastSavedValue.current = initialNotes;
  }, [initialNotes]);

  const handleBlur = (event: React.FocusEvent<HTMLTextAreaElement>) => {
    clearFocus(event);
    if (value === lastSavedValue.current) return;
    setError(null);
    const toSave = value;
    startTransition(async () => {
      const result = await updateNotesAction({ clientId, notes: toSave });
      if (!result.ok) {
        setError(result.error ?? "Failed to save notes.");
        return;
      }
      lastSavedValue.current = toSave;
      setSavedAt(result.data?.savedAt ?? new Date().toISOString());
    });
  };

  return (
    <div>
      <p className="eyebrow mb-4">Internal Notes</p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={applyFocus}
        onBlur={handleBlur}
        rows={10}
        placeholder="Internal notes never shown to the client."
        style={{ ...fieldStyle, minHeight: 200, resize: "vertical" }}
      />
      <div
        className="mt-2 flex items-center justify-between"
        style={{ fontSize: 12, color: "var(--text-muted)" }}
      >
        <span>{isPending ? "Saving…" : formatSavedAt(savedAt)}</span>
        {error && (
          <span style={{ color: "var(--status-danger)" }}>{error}</span>
        )}
      </div>
    </div>
  );
}
