"use client";

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  EXPENSE_CATEGORY_LABELS,
  type ExpenseRow,
} from "../_lib/queries";
import type { ExpenseCategory } from "@/lib/supabase";
import type { ExpenseSuggestion } from "../_lib/suggestions";
import type { CommitResult } from "../_lib/types";
import { InlineCell } from "./InlineCell";
import type { DraftExpenseRow } from "./FinancialsBoard";

interface ExpenseTableProps {
  rows: ExpenseRow[];
  onUpdate: (
    rowId: string,
    patch: Partial<ExpenseRow>
  ) => Promise<CommitResult>;
  onDelete: (rowId: string) => Promise<CommitResult>;
  draft: DraftExpenseRow;
  draftKey: string;
  draftSaving: boolean;
  draftError: string | null;
  onDraftFieldChange: <K extends keyof DraftExpenseRow>(
    field: K,
    value: DraftExpenseRow[K]
  ) => Promise<CommitResult>;
  suggestions: ExpenseSuggestion[];
  onSuggestionAccept: (
    suggestion: ExpenseSuggestion
  ) => Promise<CommitResult>;
  onSuggestionDismiss: (
    suggestion: ExpenseSuggestion
  ) => Promise<CommitResult>;
  /** Optional success notifications. The table also clears its own local
   * `sugDrafts` entry on success — these callbacks let the parent observe
   * the same event if it ever needs to. */
  onAcceptSuccess?: (referenceId: string) => void;
  onDismissSuccess?: (referenceId: string) => void;
}

const EXPENSE_CATEGORY_OPTIONS = (
  Object.entries(EXPENSE_CATEGORY_LABELS) as Array<[ExpenseCategory, string]>
).map(([value, label]) => ({ value, label }));

const COLUMN_COUNT = 6;

export function ExpenseTable({
  rows,
  onUpdate,
  onDelete,
  draft,
  draftKey,
  draftSaving,
  draftError,
  onDraftFieldChange,
  suggestions,
  onSuggestionAccept,
  onSuggestionDismiss,
  onAcceptSuccess,
  onDismissSuccess,
}: ExpenseTableProps) {
  const [confirmRowId, setConfirmRowId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // sugDrafts keys are cleared in handleAccept / handleDismiss below so the
  // map can't grow unboundedly across a long session.
  const [sugDrafts, setSugDrafts] = useState<
    Map<string, Partial<ExpenseSuggestion>>
  >(new Map());

  const clearDraft = (refId: string) => {
    setSugDrafts((m) => {
      if (!m.has(refId)) return m;
      const next = new Map(m);
      next.delete(refId);
      return next;
    });
  };

  const handleAccept = async (sug: ExpenseSuggestion) => {
    const res = await onSuggestionAccept(effective(sug));
    if (res.ok) {
      clearDraft(sug.referenceId);
      onAcceptSuccess?.(sug.referenceId);
    }
  };

  const handleDismiss = async (sug: ExpenseSuggestion) => {
    const res = await onSuggestionDismiss(sug);
    if (res.ok) {
      clearDraft(sug.referenceId);
      onDismissSuccess?.(sug.referenceId);
    }
  };

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

  const effective = (sug: ExpenseSuggestion): ExpenseSuggestion => {
    const o = sugDrafts.get(sug.referenceId);
    return o ? { ...sug, ...o } : sug;
  };
  const patchDraft = (sug: ExpenseSuggestion, p: Partial<ExpenseSuggestion>) => {
    setSugDrafts((m) => {
      const next = new Map(m);
      next.set(sug.referenceId, { ...(next.get(sug.referenceId) ?? {}), ...p });
      return next;
    });
    return Promise.resolve<CommitResult>({ ok: true });
  };

  const closeConfirm = () => {
    if (deleting) return;
    setConfirmRowId(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!confirmRowId) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await onDelete(confirmRowId);
    setDeleting(false);
    if (res.ok) {
      setConfirmRowId(null);
    } else {
      setDeleteError(res.error ?? "Delete failed");
    }
  };

  return (
    <>
      <div
        style={{
          border: "1px solid var(--border)",
          backgroundColor: "var(--surface-raised)",
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Category</th>
              <th>Description</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Notes</th>
              <th style={{ width: 40 }} aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="fb-row">
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="date"
                    label="Date"
                    value={row.date}
                    onCommit={(v) => onUpdate(row.id, { date: v ?? "" })}
                  />
                </td>
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="enum"
                    label="Category"
                    value={row.category}
                    options={EXPENSE_CATEGORY_OPTIONS}
                    onCommit={(v) =>
                      onUpdate(row.id, {
                        category: (v ?? "") as ExpenseCategory,
                      })
                    }
                  />
                </td>
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="text"
                    label="Description"
                    value={row.description}
                    onCommit={(v) => onUpdate(row.id, { description: v })}
                  />
                </td>
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="money"
                    label="Amount"
                    value={row.amount}
                    align="right"
                    onCommit={(v) => onUpdate(row.id, { amount: v ?? 0 })}
                  />
                </td>
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="text"
                    label="Notes"
                    value={row.notes}
                    onCommit={(v) => onUpdate(row.id, { notes: v })}
                  />
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="fb-row-delete"
                    aria-label="Delete row"
                    onClick={() => setConfirmRowId(row.id)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            {sortedSuggestions.map((sug) => {
              const eff = effective(sug);
              return (
                <tr
                  key={`sug-${sug.referenceId}`}
                  className="fb-row fb-row-suggestion"
                >
                  <td style={{ padding: 0 }}>
                    <InlineCell
                      type="date"
                      label="Date"
                      value={eff.suggestedDate}
                      onCommit={(v) =>
                        patchDraft(sug, { suggestedDate: v ?? "" })
                      }
                    />
                  </td>
                  <td style={{ padding: 0 }}>
                    <InlineCell
                      type="enum"
                      label="Category"
                      value={eff.category}
                      options={EXPENSE_CATEGORY_OPTIONS}
                      onCommit={(v) =>
                        patchDraft(sug, {
                          category: (v ?? "business_operations") as ExpenseCategory,
                        })
                      }
                    />
                  </td>
                  <td style={{ padding: 0 }}>
                    <InlineCell
                      type="text"
                      label="Description"
                      value={eff.name}
                      onCommit={(v) => patchDraft(sug, { name: v ?? "" })}
                    />
                  </td>
                  <td style={{ padding: 0 }}>
                    <InlineCell
                      type="money"
                      label="Amount"
                      value={eff.amount}
                      align="right"
                      onCommit={(v) => patchDraft(sug, { amount: v ?? 0 })}
                    />
                  </td>
                  <td style={{ padding: 0 }}>
                    <InlineCell
                      type="text"
                      label="Notes"
                      value={eff.notes ?? null}
                      placeholder="Notes…"
                      onCommit={(v) => patchDraft(sug, { notes: v })}
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="fb-suggestion-actions">
                      <button
                        type="button"
                        className="fb-suggestion-btn fb-suggestion-btn-accept"
                        aria-label="Accept suggestion"
                        onClick={() => handleAccept(sug)}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="fb-suggestion-btn fb-suggestion-btn-dismiss"
                        aria-label="Dismiss suggestion"
                        onClick={() => handleDismiss(sug)}
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr
              key={draftKey}
              className={`fb-row${draftSaving ? " fb-row-saving" : ""}`}
            >
              <td style={{ padding: 0 }}>
                <InlineCell
                  type="date"
                  label="Date"
                  value={draft.date}
                  placeholder="Add date…"
                  onCommit={(v) => onDraftFieldChange("date", v)}
                />
              </td>
              <td style={{ padding: 0 }}>
                <InlineCell
                  type="enum"
                  label="Category"
                  value={draft.category}
                  placeholder="Select category…"
                  options={EXPENSE_CATEGORY_OPTIONS}
                  onCommit={(v) =>
                    onDraftFieldChange(
                      "category",
                      v === null ? null : (v as ExpenseCategory)
                    )
                  }
                />
              </td>
              <td style={{ padding: 0 }}>
                <InlineCell
                  type="text"
                  label="Description"
                  value={draft.description}
                  placeholder="Description…"
                  onCommit={(v) => onDraftFieldChange("description", v)}
                />
              </td>
              <td style={{ padding: 0 }}>
                <InlineCell
                  type="money"
                  label="Amount"
                  value={draft.amount}
                  align="right"
                  placeholder="$0"
                  onCommit={(v) => onDraftFieldChange("amount", v)}
                />
              </td>
              <td style={{ padding: 0 }}>
                <InlineCell
                  type="text"
                  label="Notes"
                  value={draft.notes}
                  placeholder="Notes…"
                  onCommit={(v) => onDraftFieldChange("notes", v)}
                />
              </td>
              <td style={{ textAlign: "right" }}>
                {draftSaving && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      paddingRight: 8,
                    }}
                  >
                    Saving…
                  </span>
                )}
              </td>
            </tr>
            {draftError && (
              <tr key={`${draftKey}-error`}>
                <td
                  colSpan={COLUMN_COUNT}
                  style={{
                    padding: "8px 16px",
                    color: "var(--status-danger)",
                    fontSize: 13,
                    backgroundColor: "rgba(122,48,64,0.08)",
                  }}
                >
                  {draftError}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmRowId !== null}
        onCancel={closeConfirm}
        onConfirm={handleConfirmDelete}
        title="Delete this expense?"
        body={
          <>
            This can&apos;t be undone.
            {deleteError && (
              <div
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
        busy={deleting}
      />
    </>
  );
}
