"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  EditSheet,
  SheetField,
  sheetInputStyle,
  sheetReadonlyStyle,
} from "@/components/ui/EditSheet";
import { formatCurrency, formatDate } from "@/app/owner/clients/_lib/format";
import type { MileageRow } from "../_lib/queries";
import type { MileageSuggestion } from "../_lib/suggestions";
import type { CommitResult } from "../_lib/types";
import type { DraftMileageRow } from "./FinancialsBoard";
import { CardRow, CardShell, fieldRowsStyle, headlineStyle } from "./cardShared";

interface MileageCardListProps {
  rows: MileageRow[];
  onUpdate: (rowId: string, patch: Partial<MileageRow>) => Promise<CommitResult>;
  onDelete: (rowId: string) => Promise<CommitResult>;
  onCreate: (draft: DraftMileageRow) => Promise<CommitResult>;
  suggestions: MileageSuggestion[];
  onSuggestionAccept: (sug: MileageSuggestion) => Promise<CommitResult>;
  onSuggestionDismiss: (sug: MileageSuggestion) => Promise<CommitResult>;
  /** Current IRS rate from app_settings.mileage_rate_per_mile. Shown as
   * read-only context in the sheet. May be null if not provided — the
   * Rate row falls back to a derived value or an em-dash. */
  currentRatePerMile: number | null;
}

type SheetMode =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; row: MileageRow };

interface MileageFormState {
  date: string;
  fromAddress: string;
  toAddress: string;
  miles: string;
}

const emptyForm: MileageFormState = {
  date: "",
  fromAddress: "",
  toAddress: "",
  miles: "",
};

function rowToForm(row: MileageRow): MileageFormState {
  return {
    date: row.date,
    fromAddress: row.fromAddress,
    toAddress: row.toAddress,
    miles: String(row.miles),
  };
}

export function MileageCardList({
  rows,
  onUpdate,
  onDelete,
  onCreate,
  suggestions,
  onSuggestionAccept,
  onSuggestionDismiss,
  currentRatePerMile,
}: MileageCardListProps) {
  const [mode, setMode] = useState<SheetMode>({ kind: "none" });
  const [form, setForm] = useState<MileageFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sugBusy, setSugBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (mode.kind === "create") setForm(emptyForm);
    else if (mode.kind === "edit") setForm(rowToForm(mode.row));
    setError(null);
  }, [mode]);

  const sortedSuggestions = useMemo(
    () =>
      [...suggestions].sort((a, b) => {
        if (a.tripDate !== b.tripDate) {
          return a.tripDate < b.tripDate ? 1 : -1;
        }
        return a.clientName.localeCompare(b.clientName);
      }),
    [suggestions]
  );

  const sheetOpen = mode.kind !== "none";
  const closeSheet = () => {
    if (saving) return;
    setMode({ kind: "none" });
  };

  const setSugInFlight = (refId: string, on: boolean) => {
    setSugBusy((s) => {
      const next = new Set(s);
      if (on) next.add(refId);
      else next.delete(refId);
      return next;
    });
  };

  const handleAccept = async (sug: MileageSuggestion) => {
    if (sugBusy.has(sug.referenceId)) return;
    setSugInFlight(sug.referenceId, true);
    await onSuggestionAccept(sug);
    setSugInFlight(sug.referenceId, false);
  };
  const handleDismiss = async (sug: MileageSuggestion) => {
    if (sugBusy.has(sug.referenceId)) return;
    setSugInFlight(sug.referenceId, true);
    await onSuggestionDismiss(sug);
    setSugInFlight(sug.referenceId, false);
  };

  const parseMiles = (raw: string): number | null => {
    const cleaned = raw.replace(/,/g, "").trim();
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const isFormValid = (): boolean => {
    if (!form.date) return false;
    if (!form.fromAddress.trim()) return false;
    if (!form.toAddress.trim()) return false;
    const m = parseMiles(form.miles);
    if (m === null || m <= 0) return false;
    return true;
  };

  // Pick a "display rate" for the readonly Rate row in the sheet.
  //  - When editing, the row's own snapshot rate is the truthful value.
  //  - When creating, prefer app_settings.mileage_rate_per_mile from props.
  //  - Fallback to the first row's rate so the cell still shows something
  //    when app_settings hasn't been threaded through yet.
  const displayRate =
    mode.kind === "edit"
      ? mode.row.ratePerMile
      : currentRatePerMile ?? rows[0]?.ratePerMile ?? null;

  const previewMiles = parseMiles(form.miles);
  const previewDeduction =
    previewMiles !== null && displayRate !== null
      ? previewMiles * displayRate
      : null;

  const handleSave = async () => {
    if (!isFormValid()) {
      setError("Fill in date, from, to, and positive miles.");
      return;
    }
    const miles = parseMiles(form.miles)!;
    setSaving(true);
    setError(null);
    try {
      if (mode.kind === "create") {
        const res = await onCreate({
          date: form.date,
          fromAddress: form.fromAddress.trim(),
          toAddress: form.toAddress.trim(),
          miles,
        });
        if (!res.ok) {
          setError(res.error ?? "Failed to save");
          return;
        }
        setMode({ kind: "none" });
      } else if (mode.kind === "edit") {
        const before = mode.row;
        const patch: Partial<MileageRow> = {};
        if (form.date !== before.date) patch.date = form.date;
        if (form.fromAddress.trim() !== before.fromAddress) {
          patch.fromAddress = form.fromAddress.trim();
        }
        if (form.toAddress.trim() !== before.toAddress) {
          patch.toAddress = form.toAddress.trim();
        }
        if (miles !== before.miles) patch.miles = miles;

        if (Object.keys(patch).length === 0) {
          setMode({ kind: "none" });
          return;
        }
        const res = await onUpdate(before.id, patch);
        if (!res.ok) {
          setError(res.error ?? "Failed to save");
          return;
        }
        setMode({ kind: "none" });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (mode.kind !== "edit") return;
    const confirmed = window.confirm("Delete this mileage entry?");
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    const res = await onDelete(mode.row.id);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Delete failed");
      return;
    }
    setMode({ kind: "none" });
  };

  return (
    <>
      <div style={listStyle}>
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => setMode({ kind: "edit", row })}
            style={cardButtonStyle}
            aria-label="Edit mileage entry"
          >
            <CardShell>
              <div style={{ ...headlineStyle, color: "var(--status-success)" }}>
                {formatCurrency(row.deduction)}
              </div>
              <div style={fieldRowsStyle}>
                <CardRow label="Date" value={formatDate(row.date)} />
                <CardRow label="From" value={row.fromAddress} />
                <CardRow label="To" value={row.toAddress} />
                <CardRow
                  label="Miles"
                  numeric
                  value={row.miles.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}
                />
                <CardRow
                  label="Rate"
                  numeric
                  value={`$${row.ratePerMile.toFixed(2)}/mi`}
                />
                <CardRow
                  label="Client"
                  value={row.clientName ?? "—"}
                  muted={row.clientName === null}
                />
              </div>
            </CardShell>
          </button>
        ))}

        {sortedSuggestions.map((sug) => {
          const busy = sugBusy.has(sug.referenceId);
          return (
            <div key={`sug-${sug.referenceId}`}>
              <CardShell suggested>
                <div style={pillRowStyle}>
                  <span style={pillStyle}>Suggested</span>
                </div>
                <div
                  style={{
                    ...headlineStyle,
                    color: "var(--status-success)",
                    fontStyle: "italic",
                  }}
                >
                  Calculate on accept
                </div>
                <div style={fieldRowsStyle}>
                  <CardRow label="Date" value={formatDate(sug.tripDate)} />
                  <CardRow label="From" value={sug.fromAddress} />
                  <CardRow label="To" value={sug.toAddress} />
                  <CardRow
                    label="Client"
                    value={sug.clientName || "—"}
                    muted={!sug.clientName}
                  />
                </div>
                <div style={suggestionActionsStyle}>
                  <button
                    type="button"
                    onClick={() => handleDismiss(sug)}
                    disabled={busy}
                    style={{
                      ...sugBtnBase,
                      ...sugBtnDismissStyle,
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    ✕ Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAccept(sug)}
                    disabled={busy}
                    style={{
                      ...sugBtnBase,
                      ...sugBtnAcceptStyle,
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    {busy ? "Calculating…" : "✓ Accept"}
                  </button>
                </div>
              </CardShell>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setMode({ kind: "create" })}
          style={addCardStyle}
        >
          + Add mileage trip
        </button>
      </div>

      <EditSheet
        open={sheetOpen}
        onClose={closeSheet}
        title={mode.kind === "edit" ? "Edit mileage" : "Add mileage"}
        onSave={handleSave}
        onDelete={mode.kind === "edit" ? handleDelete : undefined}
        isSaving={saving}
        saveDisabled={!isFormValid()}
        error={error}
      >
        <SheetField label="Date" htmlFor="mileage-date">
          <input
            id="mileage-date"
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            style={sheetInputStyle}
          />
        </SheetField>

        <SheetField label="From" htmlFor="mileage-from">
          <input
            id="mileage-from"
            type="text"
            value={form.fromAddress}
            onChange={(e) =>
              setForm((f) => ({ ...f, fromAddress: e.target.value }))
            }
            placeholder="Start address"
            style={sheetInputStyle}
          />
        </SheetField>

        <SheetField label="To" htmlFor="mileage-to">
          <input
            id="mileage-to"
            type="text"
            value={form.toAddress}
            onChange={(e) =>
              setForm((f) => ({ ...f, toAddress: e.target.value }))
            }
            placeholder="Destination"
            style={sheetInputStyle}
          />
        </SheetField>

        <SheetField label="Miles" htmlFor="mileage-miles">
          <input
            id="mileage-miles"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={form.miles}
            onChange={(e) => setForm((f) => ({ ...f, miles: e.target.value }))}
            placeholder="0"
            style={sheetInputStyle}
          />
        </SheetField>

        <SheetField label="Rate (IRS)" hint="Read-only">
          <div style={sheetReadonlyStyle}>
            {displayRate !== null ? `$${displayRate.toFixed(2)} / mile` : "—"}
          </div>
        </SheetField>

        <SheetField label="Deduction" hint="Computed">
          <div style={sheetReadonlyStyle}>
            {previewDeduction !== null
              ? formatCurrency(previewDeduction)
              : "—"}
          </div>
        </SheetField>

        {mode.kind === "edit" && (
          <SheetField label="Client" hint="Set by suggestion">
            <div style={sheetReadonlyStyle}>{mode.row.clientName ?? "—"}</div>
          </SheetField>
        )}
      </EditSheet>
    </>
  );
}

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const cardButtonStyle: CSSProperties = {
  display: "block",
  width: "100%",
  padding: 0,
  background: "transparent",
  border: "none",
  textAlign: "left",
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
};

const pillRowStyle: CSSProperties = {
  display: "flex",
};

const pillStyle: CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  backgroundColor: "var(--accent)",
  color: "var(--surface-base)",
  marginBottom: 8,
};

const suggestionActionsStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 12,
};

const sugBtnBase: CSSProperties = {
  flex: 1,
  height: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.04em",
  fontFamily: "inherit",
  cursor: "pointer",
};

const sugBtnAcceptStyle: CSSProperties = {
  border: "1px solid var(--accent)",
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
};

const sugBtnDismissStyle: CSSProperties = {
  border: "1px solid var(--border)",
  backgroundColor: "transparent",
  color: "var(--text-body)",
};

const addCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  minHeight: 48,
  padding: 12,
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "0.02em",
  color: "var(--text-muted)",
  backgroundColor: "transparent",
  border: "1px dashed var(--border)",
  fontFamily: "inherit",
  cursor: "pointer",
};
