"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { MobileTableScroll } from "@/components/ui/MobileTableScroll";
import { InlineCell } from "@/app/owner/financials/_components/InlineCell";
import { EXPENSE_CATEGORY_LABELS } from "@/app/owner/financials/_lib/queries";
import type { CommitResult } from "@/app/owner/financials/_lib/types";
import type {
  ExpenseCategory,
  RecurringExpenseTemplateRecord,
} from "@/lib/supabase";
import {
  createRecurringExpenseTemplateAction,
  deleteRecurringExpenseTemplateAction,
  toggleTemplateActiveAction,
  updateRecurringExpenseTemplateAction,
} from "../_actions";

interface TemplatesTableSectionProps {
  initial: RecurringExpenseTemplateRecord[];
}

const CATEGORY_OPTIONS = (
  Object.entries(EXPENSE_CATEGORY_LABELS) as Array<[ExpenseCategory, string]>
).map(([value, label]) => ({ value, label }));

type DraftRow = {
  name: string | null;
  category: ExpenseCategory | null;
  amount: number | null;
  day_of_month: number | null;
  notes: string | null;
};

const COLUMN_COUNT = 7;

function emptyDraft(): DraftRow {
  return {
    name: null,
    category: null,
    amount: null,
    day_of_month: null,
    notes: null,
  };
}

function isDraftComplete(d: DraftRow): boolean {
  return (
    d.name !== null &&
    d.name.trim() !== "" &&
    d.category !== null &&
    d.amount !== null &&
    d.amount > 0 &&
    d.day_of_month !== null &&
    d.day_of_month >= 1 &&
    d.day_of_month <= 28
  );
}

// Active first, then alpha — matches the server query's ORDER BY so the
// post-insert local-state ordering doesn't drift from a fresh render.
function sortTemplates(
  rows: RecurringExpenseTemplateRecord[]
): RecurringExpenseTemplateRecord[] {
  return [...rows].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function TemplatesTableSection({ initial }: TemplatesTableSectionProps) {
  const [templates, setTemplates] = useState(() => sortTemplates(initial));

  const [draft, setDraft] = useState<DraftRow>(emptyDraft);
  const [draftKey, setDraftKey] = useState(
    () => `draft-${crypto.randomUUID()}`
  );
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmName =
    confirmId !== null
      ? templates.find((t) => t.id === confirmId)?.name ?? "this template"
      : "";

  const handleUpdate = async (
    id: string,
    patch: Partial<RecurringExpenseTemplateRecord>
  ): Promise<CommitResult> => {
    const res = await updateRecurringExpenseTemplateAction(id, patch);
    if (!res.ok || !res.data) {
      return { ok: false, error: res.error };
    }
    const updated = res.data;
    setTemplates((rows) =>
      sortTemplates(rows.map((r) => (r.id === id ? updated : r)))
    );
    return { ok: true };
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    const snapshot = templates;
    setTemplates((rows) =>
      sortTemplates(rows.map((r) => (r.id === id ? { ...r, active } : r)))
    );
    const res = await toggleTemplateActiveAction(id, active);
    if (!res.ok || !res.data) {
      setTemplates(snapshot);
    }
  };

  const closeConfirm = () => {
    if (deleting) return;
    setConfirmId(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!confirmId) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteRecurringExpenseTemplateAction(confirmId);
    setDeleting(false);
    if (!res.ok) {
      setDeleteError(res.error ?? "Delete failed");
      return;
    }
    setTemplates((rows) => rows.filter((r) => r.id !== confirmId));
    setConfirmId(null);
  };

  const handleDraftField = async <K extends keyof DraftRow>(
    field: K,
    value: DraftRow[K]
  ): Promise<CommitResult> => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setDraftError(null);
    if (!isDraftComplete(next)) {
      return { ok: true };
    }
    setDraftSaving(true);
    const res = await createRecurringExpenseTemplateAction({
      name: next.name!,
      category: next.category!,
      amount: next.amount!,
      day_of_month: next.day_of_month!,
      notes: next.notes,
    });
    setDraftSaving(false);
    if (!res.ok || !res.data) {
      setDraftError(res.error ?? "Save failed");
      return { ok: false, error: res.error };
    }
    setTemplates((rows) => sortTemplates([res.data!, ...rows]));
    setDraft(emptyDraft());
    setDraftKey(`draft-${crypto.randomUUID()}`);
    return { ok: true };
  };

  return (
    <DashboardCard
      eyebrow="RECURRING"
      title="Expense Templates"
    >
      <MobileTableScroll minWidth={780}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th style={{ textAlign: "right" }}>Day</th>
              <th style={{ textAlign: "center", width: 80 }}>Active</th>
              <th>Notes</th>
              <th style={{ width: 40 }} aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {templates.map((row) => (
              <TemplateRow
                key={row.id}
                row={row}
                onUpdate={handleUpdate}
                onToggleActive={handleToggleActive}
                onRequestDelete={() => setConfirmId(row.id)}
              />
            ))}
            <DraftRowComponent
              draftKey={draftKey}
              draft={draft}
              draftSaving={draftSaving}
              onDraftField={handleDraftField}
            />
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
      </MobileTableScroll>

      <p
        style={{
          marginTop: 12,
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        Day: 1–28 to keep February safe.
      </p>

      <ConfirmDialog
        open={confirmId !== null}
        onCancel={closeConfirm}
        onConfirm={handleConfirmDelete}
        title={`Delete ${confirmName}?`}
        body={
          <>
            Past expenses will be kept but lose their template link. To stop
            the monthly suggestion without losing the link, toggle Active off
            instead.
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
        busy={deleting}
      />
    </DashboardCard>
  );
}

// ---------------------------------------------------------------------------
// TemplateRow — one existing-template row
// ---------------------------------------------------------------------------

interface TemplateRowProps {
  row: RecurringExpenseTemplateRecord;
  onUpdate: (
    id: string,
    patch: Partial<RecurringExpenseTemplateRecord>
  ) => Promise<CommitResult>;
  onToggleActive: (id: string, active: boolean) => void;
  onRequestDelete: () => void;
}

function TemplateRow({
  row,
  onUpdate,
  onToggleActive,
  onRequestDelete,
}: TemplateRowProps) {
  const [togglePending, startToggle] = useTransition();

  const rowClass = `st-row${row.active ? "" : " st-row-inactive"}`;

  return (
    <tr className={rowClass}>
      <td style={{ padding: 0 }}>
        <InlineCell
          type="text"
          label="Template name"
          value={row.name}
          onCommit={(v) =>
            onUpdate(row.id, { name: v === null ? "" : v })
          }
        />
      </td>
      <td style={{ padding: 0 }}>
        <InlineCell
          type="enum"
          label="Category"
          value={row.category}
          options={CATEGORY_OPTIONS}
          onCommit={(v) =>
            onUpdate(row.id, { category: (v ?? row.category) as ExpenseCategory })
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
          type="number"
          label="Day of month"
          value={row.day_of_month}
          align="right"
          onCommit={(v) => onUpdate(row.id, { day_of_month: v ?? 0 })}
        />
      </td>
      <td style={{ textAlign: "center" }}>
        <input
          type="checkbox"
          className="st-active-checkbox"
          aria-label={row.active ? "Deactivate template" : "Activate template"}
          checked={row.active}
          disabled={togglePending}
          onChange={(e) => {
            const next = e.target.checked;
            startToggle(() => onToggleActive(row.id, next));
          }}
        />
      </td>
      <td style={{ padding: 0 }}>
        <InlineCell
          type="text"
          label="Notes"
          value={row.notes}
          placeholder="Notes…"
          onCommit={(v) => onUpdate(row.id, { notes: v })}
        />
      </td>
      <td style={{ textAlign: "right" }}>
        <button
          type="button"
          className="st-row-delete"
          aria-label="Delete template"
          onClick={onRequestDelete}
        >
          ×
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// DraftRowComponent — the ghost row at the bottom of the table
// ---------------------------------------------------------------------------

interface DraftRowProps {
  draftKey: string;
  draft: DraftRow;
  draftSaving: boolean;
  onDraftField: <K extends keyof DraftRow>(
    field: K,
    value: DraftRow[K]
  ) => Promise<CommitResult>;
}

function DraftRowComponent({
  draftKey,
  draft,
  draftSaving,
  onDraftField,
}: DraftRowProps) {
  return (
    <tr
      key={draftKey}
      className={`st-row${draftSaving ? " st-row-saving" : ""}`}
    >
      <td style={{ padding: 0 }}>
        <InlineCell
          type="text"
          label="Template name"
          value={draft.name}
          placeholder="Add name…"
          onCommit={(v) => onDraftField("name", v)}
        />
      </td>
      <td style={{ padding: 0 }}>
        <InlineCell
          type="enum"
          label="Category"
          value={draft.category}
          placeholder="Select category…"
          options={CATEGORY_OPTIONS}
          onCommit={(v) =>
            onDraftField(
              "category",
              v === null ? null : (v as ExpenseCategory)
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
          onCommit={(v) => onDraftField("amount", v)}
        />
      </td>
      <td style={{ padding: 0 }}>
        <InlineCell
          type="number"
          label="Day of month"
          value={draft.day_of_month}
          align="right"
          placeholder="Day…"
          onCommit={(v) => onDraftField("day_of_month", v)}
        />
      </td>
      <td
        style={{
          textAlign: "center",
          color: "var(--text-muted)",
          fontStyle: "italic",
          fontSize: 13,
        }}
      >
        —
      </td>
      <td style={{ padding: 0 }}>
        <InlineCell
          type="text"
          label="Notes"
          value={draft.notes}
          placeholder="Notes…"
          onCommit={(v) => onDraftField("notes", v)}
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
  );
}
