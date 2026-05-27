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
  sheetTextareaStyle,
} from "@/components/ui/EditSheet";
import { formatCurrency, formatDate } from "@/app/owner/clients/_lib/format";
import {
  EXPENSE_CATEGORY_LABELS,
  type ExpenseRow,
} from "../_lib/queries";
import type { ExpenseCategory } from "@/lib/supabase";
import type { ExpenseSuggestion } from "../_lib/suggestions";
import type { CommitResult } from "../_lib/types";
import type { DraftExpenseRow } from "./FinancialsBoard";
import { CardRow, CardShell, fieldRowsStyle, headlineStyle } from "./cardShared";

const EXPENSE_CATEGORY_VALUES: ExpenseCategory[] = [
  "platform_software",
  "marketing_advertising",
  "equipment_gear",
  "travel_transportation",
  "professional_services",
  "business_operations",
];

interface ExpenseCardListProps {
  rows: ExpenseRow[];
  onUpdate: (rowId: string, patch: Partial<ExpenseRow>) => Promise<CommitResult>;
  onDelete: (rowId: string) => Promise<CommitResult>;
  onCreate: (draft: DraftExpenseRow) => Promise<CommitResult>;
  suggestions: ExpenseSuggestion[];
  onSuggestionAccept: (sug: ExpenseSuggestion) => Promise<CommitResult>;
  onSuggestionDismiss: (sug: ExpenseSuggestion) => Promise<CommitResult>;
}

type SheetMode =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; row: ExpenseRow };

interface ExpenseFormState {
  date: string;
  category: ExpenseCategory | "";
  description: string;
  amount: string;
  notes: string;
}

const emptyForm: ExpenseFormState = {
  date: "",
  category: "",
  description: "",
  amount: "",
  notes: "",
};

function rowToForm(row: ExpenseRow): ExpenseFormState {
  return {
    date: row.date,
    category: row.category,
    description: row.description ?? "",
    amount: String(row.amount),
    notes: row.notes ?? "",
  };
}

export function ExpenseCardList({
  rows,
  onUpdate,
  onDelete,
  onCreate,
  suggestions,
  onSuggestionAccept,
  onSuggestionDismiss,
}: ExpenseCardListProps) {
  const [mode, setMode] = useState<SheetMode>({ kind: "none" });
  const [form, setForm] = useState<ExpenseFormState>(emptyForm);
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
        if (a.suggestedDate !== b.suggestedDate) {
          return a.suggestedDate < b.suggestedDate ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
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

  const handleAccept = async (sug: ExpenseSuggestion) => {
    if (sugBusy.has(sug.referenceId)) return;
    setSugInFlight(sug.referenceId, true);
    await onSuggestionAccept(sug);
    setSugInFlight(sug.referenceId, false);
  };
  const handleDismiss = async (sug: ExpenseSuggestion) => {
    if (sugBusy.has(sug.referenceId)) return;
    setSugInFlight(sug.referenceId, true);
    await onSuggestionDismiss(sug);
    setSugInFlight(sug.referenceId, false);
  };

  const parseAmount = (raw: string): number | null => {
    const cleaned = raw.replace(/^\$/, "").replace(/,/g, "").trim();
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const isFormValid = (): boolean => {
    if (!form.date) return false;
    if (!form.category) return false;
    const n = parseAmount(form.amount);
    if (n === null || n <= 0) return false;
    return true;
  };

  const handleSave = async () => {
    if (!isFormValid()) {
      setError("Fill in date, category, and a positive amount.");
      return;
    }
    const amount = parseAmount(form.amount)!;
    setSaving(true);
    setError(null);
    try {
      if (mode.kind === "create") {
        const res = await onCreate({
          date: form.date,
          category: form.category as ExpenseCategory,
          description: form.description.trim() || null,
          amount,
          notes: form.notes.trim() || null,
        });
        if (!res.ok) {
          setError(res.error ?? "Failed to save");
          return;
        }
        setMode({ kind: "none" });
      } else if (mode.kind === "edit") {
        const before = mode.row;
        const patch: Partial<ExpenseRow> = {};
        if (form.date !== before.date) patch.date = form.date;
        if (form.category !== before.category) {
          patch.category = form.category as ExpenseCategory;
        }
        const nextDesc = form.description.trim() || null;
        if (nextDesc !== before.description) patch.description = nextDesc;
        if (amount !== before.amount) patch.amount = amount;
        const nextNotes = form.notes.trim() || null;
        if (nextNotes !== before.notes) patch.notes = nextNotes;

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
    const confirmed = window.confirm("Delete this expense?");
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
            aria-label={`Edit expense ${
              row.description ?? EXPENSE_CATEGORY_LABELS[row.category]
            }`}
          >
            <CardShell>
              <div style={{ ...headlineStyle, color: "var(--status-danger)" }}>
                −{formatCurrency(row.amount)}
              </div>
              <div style={fieldRowsStyle}>
                <CardRow label="Date" value={formatDate(row.date)} />
                <CardRow
                  label="Category"
                  value={EXPENSE_CATEGORY_LABELS[row.category]}
                />
                <CardRow
                  label="Description"
                  value={row.description ?? "—"}
                  muted={row.description === null}
                />
                <CardRow
                  label="Notes"
                  value={row.notes ?? "—"}
                  muted={row.notes === null}
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
                <div style={{ ...headlineStyle, color: "var(--status-danger)" }}>
                  −{formatCurrency(sug.amount)}
                </div>
                <div style={fieldRowsStyle}>
                  <CardRow
                    label="Date"
                    value={formatDate(sug.suggestedDate)}
                  />
                  <CardRow
                    label="Category"
                    value={EXPENSE_CATEGORY_LABELS[sug.category]}
                  />
                  <CardRow label="Description" value={sug.name} />
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
                    ✓ Accept
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
          + Add expense
        </button>
      </div>

      <EditSheet
        open={sheetOpen}
        onClose={closeSheet}
        title={mode.kind === "edit" ? "Edit expense" : "Add expense"}
        onSave={handleSave}
        onDelete={mode.kind === "edit" ? handleDelete : undefined}
        isSaving={saving}
        saveDisabled={!isFormValid()}
        error={error}
      >
        <SheetField label="Date" htmlFor="expense-date">
          <input
            id="expense-date"
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            style={sheetInputStyle}
          />
        </SheetField>

        <SheetField label="Category" htmlFor="expense-category">
          <select
            id="expense-category"
            value={form.category}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                category: e.target.value as ExpenseCategory,
              }))
            }
            style={sheetInputStyle}
          >
            <option value="" disabled>
              Select category…
            </option>
            {EXPENSE_CATEGORY_VALUES.map((v) => (
              <option key={v} value={v}>
                {EXPENSE_CATEGORY_LABELS[v]}
              </option>
            ))}
          </select>
        </SheetField>

        <SheetField label="Description" hint="Optional" htmlFor="expense-description">
          <input
            id="expense-description"
            type="text"
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            placeholder="What was it for?"
            style={sheetInputStyle}
          />
        </SheetField>

        <SheetField label="Amount" htmlFor="expense-amount">
          <div style={amountWrapStyle}>
            <span style={amountPrefixStyle}>$</span>
            <input
              id="expense-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value }))
              }
              placeholder="0.00"
              style={{ ...sheetInputStyle, paddingLeft: 28 }}
            />
          </div>
        </SheetField>

        <SheetField label="Notes" hint="Optional" htmlFor="expense-notes">
          <textarea
            id="expense-notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Notes…"
            style={sheetTextareaStyle}
          />
        </SheetField>
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

const amountWrapStyle: CSSProperties = {
  position: "relative",
};

const amountPrefixStyle: CSSProperties = {
  position: "absolute",
  left: 14,
  top: "50%",
  transform: "translateY(-50%)",
  fontSize: 16,
  color: "var(--text-muted)",
  pointerEvents: "none",
};
