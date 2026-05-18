"use client";

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatCurrency } from "@/app/owner/clients/_lib/format";
import type { MileageRow } from "../_lib/queries";
import type { MileageSuggestion } from "../_lib/suggestions";
import type { CommitResult } from "../_lib/types";
import { InlineCell } from "./InlineCell";
import type { DraftMileageRow } from "./FinancialsBoard";

interface MileageTableProps {
  rows: MileageRow[];
  onUpdate: (
    rowId: string,
    patch: Partial<MileageRow>
  ) => Promise<CommitResult>;
  onDelete: (rowId: string) => Promise<CommitResult>;
  draft: DraftMileageRow;
  draftKey: string;
  draftSaving: boolean;
  draftError: string | null;
  onDraftFieldChange: <K extends keyof DraftMileageRow>(
    field: K,
    value: DraftMileageRow[K]
  ) => Promise<CommitResult>;
  suggestions: MileageSuggestion[];
  onSuggestionAccept: (
    suggestion: MileageSuggestion
  ) => Promise<CommitResult>;
  onSuggestionDismiss: (
    suggestion: MileageSuggestion
  ) => Promise<CommitResult>;
  /** Optional success notifications. The table also clears its own local
   * `sugDrafts` entry on success — these callbacks let the parent observe
   * the same event if it ever needs to. */
  onAcceptSuccess?: (referenceId: string) => void;
  onDismissSuccess?: (referenceId: string) => void;
}

const COLUMN_COUNT = 8;

export function MileageTable({
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
}: MileageTableProps) {
  const [confirmRowId, setConfirmRowId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // sugDrafts keys are cleared in handleAccept / handleDismiss below so the
  // map can't grow unboundedly across a long session.
  const [sugDrafts, setSugDrafts] = useState<
    Map<string, Partial<MileageSuggestion>>
  >(new Map());
  const [sugInFlight, setSugInFlight] = useState<Set<string>>(new Set());

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

  const effective = (sug: MileageSuggestion): MileageSuggestion => {
    const o = sugDrafts.get(sug.referenceId);
    return o ? { ...sug, ...o } : sug;
  };
  const patchDraft = (sug: MileageSuggestion, p: Partial<MileageSuggestion>) => {
    setSugDrafts((m) => {
      const next = new Map(m);
      next.set(sug.referenceId, { ...(next.get(sug.referenceId) ?? {}), ...p });
      return next;
    });
    return Promise.resolve<CommitResult>({ ok: true });
  };
  const setInFlight = (refId: string, on: boolean) => {
    setSugInFlight((s) => {
      const next = new Set(s);
      if (on) next.add(refId);
      else next.delete(refId);
      return next;
    });
  };
  const clearDraft = (refId: string) => {
    setSugDrafts((m) => {
      if (!m.has(refId)) return m;
      const next = new Map(m);
      next.delete(refId);
      return next;
    });
  };

  const handleAccept = async (sug: MileageSuggestion) => {
    if (sugInFlight.has(sug.referenceId)) return;
    setInFlight(sug.referenceId, true);
    const res = await onSuggestionAccept(effective(sug));
    setInFlight(sug.referenceId, false);
    if (res.ok) {
      clearDraft(sug.referenceId);
      onAcceptSuccess?.(sug.referenceId);
    }
  };
  const handleDismiss = async (sug: MileageSuggestion) => {
    if (sugInFlight.has(sug.referenceId)) return;
    setInFlight(sug.referenceId, true);
    const res = await onSuggestionDismiss(sug);
    setInFlight(sug.referenceId, false);
    if (res.ok) {
      clearDraft(sug.referenceId);
      onDismissSuccess?.(sug.referenceId);
    }
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
              <th>From</th>
              <th>To</th>
              <th style={{ textAlign: "right" }}>Miles</th>
              <th style={{ textAlign: "right" }}>Rate</th>
              <th style={{ textAlign: "right" }}>Deduction</th>
              <th>Client</th>
              <th style={{ width: 40 }} aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="fb-row">
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="date"
                    label="Trip date"
                    value={row.date}
                    onCommit={(v) => onUpdate(row.id, { date: v ?? "" })}
                  />
                </td>
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="text"
                    label="From"
                    value={row.fromAddress}
                    onCommit={(v) =>
                      onUpdate(row.id, { fromAddress: v ?? "" })
                    }
                  />
                </td>
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="text"
                    label="To"
                    value={row.toAddress}
                    onCommit={(v) =>
                      onUpdate(row.id, { toAddress: v ?? "" })
                    }
                  />
                </td>
                <td style={{ padding: 0 }}>
                  <InlineCell
                    type="number"
                    label="Miles"
                    value={row.miles}
                    align="right"
                    onCommit={(v) => onUpdate(row.id, { miles: v ?? 0 })}
                  />
                </td>
                <td style={{ textAlign: "right" }}>
                  {`$${row.ratePerMile.toFixed(2)}`}
                </td>
                <td style={{ textAlign: "right" }}>
                  {formatCurrency(row.deduction)}
                </td>
                <td>{row.clientName ?? "—"}</td>
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
              const inFlight = sugInFlight.has(sug.referenceId);
              const emDashCell = (
                <td
                  style={{
                    textAlign: "right",
                    fontStyle: "italic",
                    color: "var(--text-muted)",
                    padding: "14px 16px",
                    fontSize: 14,
                  }}
                >
                  —
                </td>
              );
              return (
                <tr
                  key={`sug-${sug.referenceId}`}
                  className={`fb-row fb-row-suggestion${inFlight ? " fb-row-saving" : ""}`}
                >
                  <td style={{ padding: 0 }}>
                    <InlineCell
                      type="date"
                      label="Trip date"
                      value={eff.tripDate}
                      onCommit={(v) => patchDraft(sug, { tripDate: v ?? "" })}
                    />
                  </td>
                  <td style={{ padding: 0 }}>
                    <InlineCell
                      type="text"
                      label="From"
                      value={eff.fromAddress}
                      onCommit={(v) =>
                        patchDraft(sug, { fromAddress: v ?? "" })
                      }
                    />
                  </td>
                  <td style={{ padding: 0 }}>
                    <InlineCell
                      type="text"
                      label="To"
                      value={eff.toAddress}
                      onCommit={(v) => patchDraft(sug, { toAddress: v ?? "" })}
                    />
                  </td>
                  {/* miles / rate / deduction all resolved on accept */}
                  {emDashCell}
                  {emDashCell}
                  {emDashCell}
                  <td
                    style={{
                      color: "var(--text-muted)",
                      padding: "14px 16px",
                      fontSize: 14,
                    }}
                  >
                    {eff.clientName || "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {inFlight ? (
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          paddingRight: 8,
                          fontStyle: "italic",
                        }}
                      >
                        Calculating…
                      </span>
                    ) : (
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
                    )}
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
                  label="Trip date"
                  value={draft.date}
                  placeholder="Add date…"
                  onCommit={(v) => onDraftFieldChange("date", v)}
                />
              </td>
              <td style={{ padding: 0 }}>
                <InlineCell
                  type="text"
                  label="From"
                  value={draft.fromAddress}
                  placeholder="From…"
                  onCommit={(v) => onDraftFieldChange("fromAddress", v)}
                />
              </td>
              <td style={{ padding: 0 }}>
                <InlineCell
                  type="text"
                  label="To"
                  value={draft.toAddress}
                  placeholder="To…"
                  onCommit={(v) => onDraftFieldChange("toAddress", v)}
                />
              </td>
              <td style={{ padding: 0 }}>
                <InlineCell
                  type="number"
                  label="Miles"
                  value={draft.miles}
                  align="right"
                  placeholder="0"
                  onCommit={(v) => onDraftFieldChange("miles", v)}
                />
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontStyle: "italic",
                  color: "var(--text-muted)",
                  padding: "14px 16px",
                  fontSize: 14,
                }}
              >
                —
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontStyle: "italic",
                  color: "var(--text-muted)",
                  padding: "14px 16px",
                  fontSize: 14,
                }}
              >
                —
              </td>
              <td
                style={{
                  color: "var(--text-muted)",
                  padding: "14px 16px",
                  fontSize: 14,
                }}
              >
                —
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
        title="Delete this mileage entry?"
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
