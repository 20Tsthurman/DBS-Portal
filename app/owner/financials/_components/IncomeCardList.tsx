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
  INCOME_TYPE_LABELS,
  type IncomeRow,
} from "../_lib/queries";
import type { IncomeType } from "@/lib/supabase";
import type { IncomeSuggestion } from "../_lib/suggestions";
import type { CommitResult } from "../_lib/types";
import type { DraftIncomeRow } from "./FinancialsBoard";
import { CardRow, CardShell, fieldRowsStyle, headlineStyle } from "./cardShared";

const INCOME_TYPE_VALUES: IncomeType[] = [
  "brand_retainer",
  "wedding_same_day",
  "one_off_shoot",
  "other",
];

interface IncomeCardListProps {
  rows: IncomeRow[];
  onUpdate: (rowId: string, patch: Partial<IncomeRow>) => Promise<CommitResult>;
  onDelete: (rowId: string) => Promise<CommitResult>;
  /** Adds a brand-new income payment via the existing addIncomePaymentAction.
   * FinancialsBoard owns the rows-state insert + sort. */
  onCreate: (draft: DraftIncomeRow) => Promise<CommitResult>;
  suggestions: IncomeSuggestion[];
  onSuggestionAccept: (sug: IncomeSuggestion) => Promise<CommitResult>;
  onSuggestionDismiss: (sug: IncomeSuggestion) => Promise<CommitResult>;
  /** Client names for the datalist in the Client field. May be empty in
   * YTD view (suggestion inputs are suppressed); free-text still works. */
  clientNames: string[];
}

type SheetMode =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; row: IncomeRow };

interface IncomeFormState {
  date: string;
  clientName: string;
  incomeType: IncomeType | "";
  amount: string;
  paymentMethod: string;
  notes: string;
}

const emptyForm: IncomeFormState = {
  date: "",
  clientName: "",
  incomeType: "",
  amount: "",
  paymentMethod: "",
  notes: "",
};

function rowToForm(row: IncomeRow): IncomeFormState {
  return {
    date: row.date,
    clientName: row.clientName,
    incomeType: row.incomeType,
    amount: String(row.amount),
    paymentMethod: row.paymentMethod ?? "",
    notes: row.notes ?? "",
  };
}

export function IncomeCardList({
  rows,
  onUpdate,
  onDelete,
  onCreate,
  suggestions,
  onSuggestionAccept,
  onSuggestionDismiss,
  clientNames,
}: IncomeCardListProps) {
  const [mode, setMode] = useState<SheetMode>({ kind: "none" });
  const [form, setForm] = useState<IncomeFormState>(emptyForm);
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

  const handleAccept = async (sug: IncomeSuggestion) => {
    if (sugBusy.has(sug.referenceId)) return;
    setSugInFlight(sug.referenceId, true);
    const res = await onSuggestionAccept(sug);
    setSugInFlight(sug.referenceId, false);
    if (!res.ok) {
      // FinancialsBoard surfaces the error in the shared `sugError` banner.
    }
  };
  const handleDismiss = async (sug: IncomeSuggestion) => {
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
    if (!form.clientName.trim()) return false;
    if (!form.incomeType) return false;
    const n = parseAmount(form.amount);
    if (n === null || n <= 0) return false;
    return true;
  };

  const handleSave = async () => {
    if (!isFormValid()) {
      setError("Fill in date, client, type, and a positive amount.");
      return;
    }
    const amount = parseAmount(form.amount)!;
    setSaving(true);
    setError(null);
    try {
      if (mode.kind === "create") {
        const res = await onCreate({
          date: form.date,
          clientName: form.clientName.trim(),
          amount,
          incomeType: form.incomeType as IncomeType,
          paymentMethod: form.paymentMethod.trim() || null,
          notes: form.notes.trim() || null,
        });
        if (!res.ok) {
          setError(res.error ?? "Failed to save");
          return;
        }
        setMode({ kind: "none" });
      } else if (mode.kind === "edit") {
        const before = mode.row;
        const patch: Partial<IncomeRow> = {};
        if (form.date !== before.date) patch.date = form.date;
        if (form.clientName.trim() !== before.clientName) {
          patch.clientName = form.clientName.trim();
        }
        if (form.incomeType !== before.incomeType) {
          patch.incomeType = form.incomeType as IncomeType;
        }
        if (amount !== before.amount) patch.amount = amount;
        const nextMethod = form.paymentMethod.trim() || null;
        if (nextMethod !== before.paymentMethod) patch.paymentMethod = nextMethod;
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
    const confirmed = window.confirm("Delete this income payment?");
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
            aria-label={`Edit income for ${row.clientName}`}
          >
            <CardShell>
              <div style={{ ...headlineStyle, color: "var(--accent)" }}>
                {formatCurrency(row.amount)}
              </div>
              <div style={fieldRowsStyle}>
                <CardRow label="Date" value={formatDate(row.date)} />
                <CardRow label="Client" value={row.clientName} />
                <CardRow
                  label="Type"
                  value={INCOME_TYPE_LABELS[row.incomeType]}
                />
                <CardRow
                  label="Method"
                  value={row.paymentMethod ?? "—"}
                  muted={row.paymentMethod === null}
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
            <div key={`sug-${sug.referenceId}`} style={suggestionWrapStyle}>
              <CardShell suggested>
                <div style={pillRowStyle}>
                  <span style={pillStyle}>Suggested</span>
                </div>
                <div style={{ ...headlineStyle, color: "var(--accent)" }}>
                  {formatCurrency(sug.amount)}
                </div>
                <div style={fieldRowsStyle}>
                  <CardRow
                    label="Date"
                    value={formatDate(sug.suggestedDate)}
                  />
                  <CardRow label="Client" value={sug.clientName} />
                  <CardRow
                    label="Type"
                    value={INCOME_TYPE_LABELS[sug.incomeType]}
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
          + Add income
        </button>
      </div>

      <EditSheet
        open={sheetOpen}
        onClose={closeSheet}
        title={mode.kind === "edit" ? "Edit income" : "Add income"}
        onSave={handleSave}
        onDelete={mode.kind === "edit" ? handleDelete : undefined}
        isSaving={saving}
        saveDisabled={!isFormValid()}
        error={error}
      >
        <SheetField label="Date" htmlFor="income-date">
          <input
            id="income-date"
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            style={sheetInputStyle}
          />
        </SheetField>

        <SheetField label="Client" htmlFor="income-client">
          <input
            id="income-client"
            type="text"
            list="income-client-options"
            value={form.clientName}
            onChange={(e) =>
              setForm((f) => ({ ...f, clientName: e.target.value }))
            }
            placeholder="Client name"
            style={sheetInputStyle}
          />
          <datalist id="income-client-options">
            {clientNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </SheetField>

        <SheetField label="Type" htmlFor="income-type">
          <select
            id="income-type"
            value={form.incomeType}
            onChange={(e) =>
              setForm((f) => ({ ...f, incomeType: e.target.value as IncomeType }))
            }
            style={sheetInputStyle}
          >
            <option value="" disabled>
              Select type…
            </option>
            {INCOME_TYPE_VALUES.map((v) => (
              <option key={v} value={v}>
                {INCOME_TYPE_LABELS[v]}
              </option>
            ))}
          </select>
        </SheetField>

        <SheetField label="Amount" htmlFor="income-amount">
          <div style={amountWrapStyle}>
            <span style={amountPrefixStyle}>$</span>
            <input
              id="income-amount"
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

        <SheetField label="Method" hint="Optional" htmlFor="income-method">
          <select
            id="income-method"
            value={form.paymentMethod}
            onChange={(e) =>
              setForm((f) => ({ ...f, paymentMethod: e.target.value }))
            }
            style={sheetInputStyle}
          >
            <option value="">—</option>
            <option value="BillPay">BillPay</option>
            <option value="Check">Check</option>
            <option value="Cash">Cash</option>
            <option value="Zelle">Zelle</option>
            <option value="Other">Other</option>
          </select>
        </SheetField>

        <SheetField label="Notes" hint="Optional" htmlFor="income-notes">
          <textarea
            id="income-notes"
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

const suggestionWrapStyle: CSSProperties = {
  display: "block",
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
