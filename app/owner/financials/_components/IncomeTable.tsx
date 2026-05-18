"use client";

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  INCOME_TYPE_LABELS,
  type IncomeRow,
} from "../_lib/queries";
import type { IncomeType } from "@/lib/supabase";
import type { IncomeSuggestion } from "../_lib/suggestions";
import type { CommitResult } from "../_lib/types";
import { InlineCell } from "./InlineCell";
import type { DraftIncomeRow } from "./FinancialsBoard";

interface IncomeTableProps {
  rows: IncomeRow[];
  onUpdate: (
    rowId: string,
    patch: Partial<IncomeRow>
  ) => Promise<CommitResult>;
  onDelete: (rowId: string) => Promise<CommitResult>;
  draft: DraftIncomeRow;
  draftKey: string;
  draftSaving: boolean;
  draftError: string | null;
  onDraftFieldChange: <K extends keyof DraftIncomeRow>(
    field: K,
    value: DraftIncomeRow[K]
  ) => Promise<CommitResult>;
  suggestions: IncomeSuggestion[];
  onSuggestionAccept: (
    suggestion: IncomeSuggestion
  ) => Promise<CommitResult>;
  onSuggestionDismiss: (
    suggestion: IncomeSuggestion
  ) => Promise<CommitResult>;
  /** Optional success notifications. The table also clears its own local
   * `sugDrafts` entry on success — these callbacks let the parent observe
   * the same event if it ever needs to. */
  onAcceptSuccess?: (referenceId: string) => void;
  onDismissSuccess?: (referenceId: string) => void;
}

const INCOME_TYPE_OPTIONS = (
  Object.entries(INCOME_TYPE_LABELS) as Array<[IncomeType, string]>
).map(([value, label]) => ({ value, label }));

const COLUMN_COUNT = 7;

export function IncomeTable({
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
}: IncomeTableProps) {
  const [confirmRowId, setConfirmRowId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Per-suggestion local edit overlay: keyed by referenceId, holds the
  // cell-level overrides Kelsey has typed before clicking ✓. The
  // effective values fed to the accept action are
  // `{ ...suggestion, ...overrides }`. The corresponding entry is cleared
  // from the map on a successful accept or dismiss (see handleAccept /
  // handleDismiss below) so this map can't grow unboundedly.
  const [sugDrafts, setSugDrafts] = useState<
    Map<string, Partial<IncomeSuggestion>>
  >(new Map());

  const clearDraft = (refId: string) => {
    setSugDrafts((m) => {
      if (!m.has(refId)) return m;
      const next = new Map(m);
      next.delete(refId);
      return next;
    });
  };

  const handleAccept = async (sug: IncomeSuggestion) => {
    const res = await onSuggestionAccept(effective(sug));
    if (res.ok) {
      clearDraft(sug.referenceId);
      onAcceptSuccess?.(sug.referenceId);
    }
  };

  const handleDismiss = async (sug: IncomeSuggestion) => {
    const res = await onSuggestionDismiss(sug);
    if (res.ok) {
      clearDraft(sug.referenceId);
      onDismissSuccess?.(sug.referenceId);
    }
  };

  // Sort by suggested date desc; for a typical month every retainer share
  // the 1st, so name asc breaks ties so the order is stable.
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

  const effective = (sug: IncomeSuggestion): IncomeSuggestion => {
    const o = sugDrafts.get(sug.referenceId);
    return o ? { ...sug, ...o } : sug;
  };
  const patchDraft = (sug: IncomeSuggestion, p: Partial<IncomeSuggestion>) => {
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
              <th>Client</th>
              <th>Type</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Method</th>
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
                    onCommit={(v) =>
                      onUpdate(row.id, { date: v ?? "" })
                    }
                  />
                </td>
                <td>{row.clientName}</td>
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="enum"
                    label="Income type"
                    value={row.incomeType}
                    options={INCOME_TYPE_OPTIONS}
                    onCommit={(v) =>
                      onUpdate(row.id, {
                        incomeType: (v ?? "") as IncomeType,
                      })
                    }
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
                    label="Payment method"
                    value={row.paymentMethod}
                    onCommit={(v) => onUpdate(row.id, { paymentMethod: v })}
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
                  <td>{eff.clientName}</td>
                  <td style={{ padding: 0 }}>
                    <InlineCell
                      type="enum"
                      label="Income type"
                      value={eff.incomeType}
                      options={INCOME_TYPE_OPTIONS}
                      onCommit={(v) =>
                        patchDraft(sug, {
                          incomeType: (v ?? "other") as IncomeType,
                        })
                      }
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
                      label="Payment method"
                      value={eff.paymentMethod ?? null}
                      placeholder="Method…"
                      onCommit={(v) => patchDraft(sug, { paymentMethod: v })}
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
                  type="text"
                  label="Client"
                  value={draft.clientName}
                  placeholder="Add client…"
                  onCommit={(v) => onDraftFieldChange("clientName", v)}
                />
              </td>
              <td style={{ padding: 0 }}>
                <InlineCell
                  type="enum"
                  label="Income type"
                  value={draft.incomeType}
                  placeholder="Select type…"
                  options={INCOME_TYPE_OPTIONS}
                  onCommit={(v) =>
                    onDraftFieldChange(
                      "incomeType",
                      v === null ? null : (v as IncomeType)
                    )
                  }
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
                  label="Payment method"
                  value={draft.paymentMethod}
                  placeholder="Method…"
                  onCommit={(v) =>
                    onDraftFieldChange("paymentMethod", v)
                  }
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
        title="Delete this income payment?"
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
