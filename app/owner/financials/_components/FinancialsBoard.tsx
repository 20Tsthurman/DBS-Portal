"use client";

import { useCallback, useMemo, useState } from "react";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/app/owner/clients/_lib/format";
import type {
  ExpenseCategory,
  IncomeType,
} from "@/lib/supabase";
import type {
  ExpenseRow,
  IncomeRow,
  MileageRow,
} from "../_lib/queries";
import type {
  ExpenseSuggestion,
  IncomeSuggestion,
  MileageSuggestion,
} from "../_lib/suggestions";
import type { CommitResult } from "../_lib/types";
import {
  acceptExpenseSuggestionAction,
  acceptIncomeSuggestionAction,
  acceptMileageSuggestionAction,
  addExpenseAction,
  addIncomePaymentAction,
  addMileageLogAction,
  deleteExpenseAction,
  deleteIncomePaymentAction,
  deleteMileageLogAction,
  dismissSuggestionAction,
  updateExpenseAction,
  updateIncomePaymentAction,
  updateMileageLogAction,
  type UpdateExpenseInput,
  type UpdateIncomePaymentInput,
  type UpdateMileageLogInput,
} from "../_actions";
import { ExpenseTable } from "./ExpenseTable";
import { IncomeTable } from "./IncomeTable";
import { MileageTable } from "./MileageTable";
import {
  IconExpenses,
  IconIncome,
  IconPiggyBank,
  IconTax,
  IconWallet,
} from "./StatCardIcons";
import { BreakdownPanel } from "./BreakdownPanel";
import { InsightsPanel } from "./InsightsPanel";

export type DraftIncomeRow = {
  date: string | null;
  clientName: string | null;
  amount: number | null;
  incomeType: IncomeType | null;
  paymentMethod: string | null;
  notes: string | null;
};

export type DraftExpenseRow = {
  date: string | null;
  category: ExpenseCategory | null;
  description: string | null;
  amount: number | null;
  notes: string | null;
};

export type DraftMileageRow = {
  date: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  miles: number | null;
};

const emptyIncomeDraft = (): DraftIncomeRow => ({
  date: null,
  clientName: null,
  amount: null,
  incomeType: null,
  paymentMethod: null,
  notes: null,
});

const emptyExpenseDraft = (): DraftExpenseRow => ({
  date: null,
  category: null,
  description: null,
  amount: null,
  notes: null,
});

const emptyMileageDraft = (): DraftMileageRow => ({
  date: null,
  fromAddress: null,
  toAddress: null,
  miles: null,
});

function isIncomeDraftComplete(d: DraftIncomeRow): boolean {
  return (
    d.date !== null &&
    d.clientName !== null &&
    d.clientName.trim() !== "" &&
    d.amount !== null &&
    d.amount > 0 &&
    d.incomeType !== null
  );
}

function isExpenseDraftComplete(d: DraftExpenseRow): boolean {
  return (
    d.date !== null &&
    d.category !== null &&
    d.amount !== null &&
    d.amount > 0
  );
}

function isMileageDraftComplete(d: DraftMileageRow): boolean {
  return (
    d.date !== null &&
    d.fromAddress !== null &&
    d.fromAddress.trim() !== "" &&
    d.toAddress !== null &&
    d.toAddress.trim() !== "" &&
    d.miles !== null &&
    d.miles > 0
  );
}

// Mirror server ORDER BY: payment_date DESC (income), date DESC (expense),
// trip_date DESC (mileage). Display rows don't carry created_at; ties within
// the same date keep insertion order, which means freshly committed rows
// land at the top of their date's group — matches the server's
// `created_at DESC` secondary sort approximately.
function sortByDateDesc<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  );
}

interface FinancialsBoardProps {
  initialIncomeRows: IncomeRow[];
  initialExpenseRows: ExpenseRow[];
  initialMileageRows: MileageRow[];
  taxRatePercent: number;
  /** Suggestion arrays for inline ghost rows. Empty in YTD view. */
  incomeSuggestions: IncomeSuggestion[];
  expenseSuggestions: ExpenseSuggestion[];
  mileageSuggestions: MileageSuggestion[];
}

// Mirrors queries.ts:229-235 — keep the formulas identical, since this is
// what drives the Summary card between server fetches.
function recomputeSummary(
  income: IncomeRow[],
  expenses: ExpenseRow[],
  mileage: MileageRow[],
  taxRatePercent: number
) {
  const incomeTotal = income.reduce((s, r) => s + r.amount, 0);
  const expensesFromTable = expenses.reduce((s, r) => s + r.amount, 0);
  const mileageDeduction = mileage.reduce(
    (s, r) => s + r.miles * r.ratePerMile,
    0
  );
  const expensesAll = expensesFromTable + mileageDeduction;
  const netProfit = incomeTotal - expensesAll;
  const taxSetAside = netProfit > 0 ? netProfit * (taxRatePercent / 100) : 0;
  // Mileage deduction reduces taxes owed (via netProfit/taxSetAside above) but does
  // not leave the bank account — so it is intentionally excluded from take-home.
  const takeHome = incomeTotal - expensesFromTable - taxSetAside;
  return {
    income: incomeTotal,
    expenses: expensesAll,
    mileageDeduction,
    netProfit,
    taxSetAside,
    takeHome,
    taxRatePercent,
  };
}

export function FinancialsBoard({
  initialIncomeRows,
  initialExpenseRows,
  initialMileageRows,
  taxRatePercent,
  incomeSuggestions,
  expenseSuggestions,
  mileageSuggestions,
}: FinancialsBoardProps) {
  const [incomeRows, setIncomeRows] = useState(initialIncomeRows);
  const [expenseRows, setExpenseRows] = useState(initialExpenseRows);
  const [mileageRows, setMileageRows] = useState(initialMileageRows);

  // Suggestion arrays. Mutated on accept/dismiss via the snapshot-and-restore
  // pattern (the `sug` parameter is the snapshot; on action failure it's
  // prepended back into the array). Mirrors the existing optimistic delete
  // pattern in handleIncomeDelete / handleExpenseDelete / handleMileageDelete.
  const [incomeSugState, setIncomeSugState] = useState(incomeSuggestions);
  const [expenseSugState, setExpenseSugState] = useState(expenseSuggestions);
  const [mileageSugState, setMileageSugState] = useState(mileageSuggestions);

  // Single shared error slot for the four suggestion handlers. Surfaces as
  // a small banner above the Summary card. The codebase has no toast
  // primitive (Phase 3a audit Section C); this is the closest match to the
  // existing `errorStyle` shape from formStyles.ts.
  const [sugError, setSugError] = useState<string | null>(null);

  const [incomeDraft, setIncomeDraft] = useState<DraftIncomeRow>(emptyIncomeDraft);
  const [expenseDraft, setExpenseDraft] = useState<DraftExpenseRow>(emptyExpenseDraft);
  const [mileageDraft, setMileageDraft] = useState<DraftMileageRow>(emptyMileageDraft);

  const [incomeDraftKey, setIncomeDraftKey] = useState<string>(
    () => `draft-${crypto.randomUUID()}`
  );
  const [expenseDraftKey, setExpenseDraftKey] = useState<string>(
    () => `draft-${crypto.randomUUID()}`
  );
  const [mileageDraftKey, setMileageDraftKey] = useState<string>(
    () => `draft-${crypto.randomUUID()}`
  );

  const [incomeDraftSaving, setIncomeDraftSaving] = useState(false);
  const [expenseDraftSaving, setExpenseDraftSaving] = useState(false);
  const [mileageDraftSaving, setMileageDraftSaving] = useState(false);

  const [incomeDraftError, setIncomeDraftError] = useState<string | null>(null);
  const [expenseDraftError, setExpenseDraftError] = useState<string | null>(null);
  const [mileageDraftError, setMileageDraftError] = useState<string | null>(null);

  const summary = useMemo(
    () =>
      recomputeSummary(incomeRows, expenseRows, mileageRows, taxRatePercent),
    [incomeRows, expenseRows, mileageRows, taxRatePercent]
  );

  // ---------- income ----------

  const handleIncomeUpdate = useCallback(
    async (
      rowId: string,
      patch: Partial<IncomeRow>
    ): Promise<CommitResult> => {
      const before = incomeRows.find((r) => r.id === rowId);
      if (!before) return { ok: false, error: "Row not found" };

      const revertPatch: Partial<IncomeRow> = {};
      for (const k of Object.keys(patch) as Array<keyof IncomeRow>) {
        (revertPatch as Record<string, unknown>)[k] = before[k];
      }

      setIncomeRows((rows) =>
        rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r))
      );

      const actionPatch: UpdateIncomePaymentInput = {};
      if (patch.date !== undefined) actionPatch.payment_date = patch.date;
      if (patch.amount !== undefined) actionPatch.amount = patch.amount;
      if (patch.incomeType !== undefined) {
        actionPatch.income_type = patch.incomeType;
      }
      if (patch.paymentMethod !== undefined) {
        actionPatch.payment_method = patch.paymentMethod;
      }
      if (patch.notes !== undefined) actionPatch.notes = patch.notes;

      const res = await updateIncomePaymentAction(rowId, actionPatch);
      if (!res.ok) {
        setIncomeRows((rows) =>
          rows.map((r) => (r.id === rowId ? { ...r, ...revertPatch } : r))
        );
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    [incomeRows]
  );

  const handleIncomeDelete = useCallback(
    async (rowId: string): Promise<CommitResult> => {
      const idx = incomeRows.findIndex((r) => r.id === rowId);
      if (idx === -1) return { ok: false, error: "Row not found" };
      const row = incomeRows[idx];
      setIncomeRows((rows) => rows.filter((r) => r.id !== rowId));

      const res = await deleteIncomePaymentAction(rowId);
      if (!res.ok) {
        setIncomeRows((rows) => {
          const next = [...rows];
          next.splice(Math.min(idx, next.length), 0, row);
          return next;
        });
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    [incomeRows]
  );

  const handleIncomeDraftFieldChange = useCallback(
    async <K extends keyof DraftIncomeRow>(
      field: K,
      value: DraftIncomeRow[K]
    ): Promise<CommitResult> => {
      if (incomeDraftSaving) return { ok: false, error: "Saving…" };
      const next: DraftIncomeRow = { ...incomeDraft, [field]: value };
      setIncomeDraft(next);
      setIncomeDraftError(null);
      if (!isIncomeDraftComplete(next)) return { ok: true };

      setIncomeDraftSaving(true);
      try {
        const res = await addIncomePaymentAction({
          payment_date: next.date!,
          client_name_snapshot: next.clientName!.trim(),
          amount: next.amount!,
          income_type: next.incomeType!,
          payment_method: next.paymentMethod ?? null,
          notes: next.notes ?? null,
        });
        if (!res.ok || !res.data) {
          setIncomeDraftError(res.error ?? "Failed to save");
          return { ok: false, error: res.error };
        }
        const newRow: IncomeRow = {
          id: res.data.id,
          date: res.data.payment_date,
          clientName: res.data.client_name_snapshot,
          incomeType: res.data.income_type,
          amount: Number(res.data.amount),
          paymentMethod: res.data.payment_method,
          notes: res.data.notes,
        };
        setIncomeRows((rows) => sortByDateDesc([...rows, newRow]));
        setIncomeDraft(emptyIncomeDraft());
        setIncomeDraftKey(`draft-${crypto.randomUUID()}`);
        return { ok: true };
      } finally {
        setIncomeDraftSaving(false);
      }
    },
    [incomeDraft, incomeDraftSaving]
  );

  // ---------- expenses ----------

  const handleExpenseUpdate = useCallback(
    async (
      rowId: string,
      patch: Partial<ExpenseRow>
    ): Promise<CommitResult> => {
      const before = expenseRows.find((r) => r.id === rowId);
      if (!before) return { ok: false, error: "Row not found" };

      const revertPatch: Partial<ExpenseRow> = {};
      for (const k of Object.keys(patch) as Array<keyof ExpenseRow>) {
        (revertPatch as Record<string, unknown>)[k] = before[k];
      }

      setExpenseRows((rows) =>
        rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r))
      );

      const actionPatch: UpdateExpenseInput = {};
      if (patch.date !== undefined) actionPatch.date = patch.date;
      if (patch.category !== undefined) actionPatch.category = patch.category;
      if (patch.description !== undefined) {
        actionPatch.description = patch.description;
      }
      if (patch.amount !== undefined) actionPatch.amount = patch.amount;
      if (patch.notes !== undefined) actionPatch.notes = patch.notes;

      const res = await updateExpenseAction(rowId, actionPatch);
      if (!res.ok) {
        setExpenseRows((rows) =>
          rows.map((r) => (r.id === rowId ? { ...r, ...revertPatch } : r))
        );
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    [expenseRows]
  );

  const handleExpenseDelete = useCallback(
    async (rowId: string): Promise<CommitResult> => {
      const idx = expenseRows.findIndex((r) => r.id === rowId);
      if (idx === -1) return { ok: false, error: "Row not found" };
      const row = expenseRows[idx];
      setExpenseRows((rows) => rows.filter((r) => r.id !== rowId));

      const res = await deleteExpenseAction(rowId);
      if (!res.ok) {
        setExpenseRows((rows) => {
          const next = [...rows];
          next.splice(Math.min(idx, next.length), 0, row);
          return next;
        });
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    [expenseRows]
  );

  const handleExpenseDraftFieldChange = useCallback(
    async <K extends keyof DraftExpenseRow>(
      field: K,
      value: DraftExpenseRow[K]
    ): Promise<CommitResult> => {
      if (expenseDraftSaving) return { ok: false, error: "Saving…" };
      const next: DraftExpenseRow = { ...expenseDraft, [field]: value };
      setExpenseDraft(next);
      setExpenseDraftError(null);
      if (!isExpenseDraftComplete(next)) return { ok: true };

      setExpenseDraftSaving(true);
      try {
        const res = await addExpenseAction({
          date: next.date!,
          category: next.category!,
          amount: next.amount!,
          description: next.description ?? null,
          notes: next.notes ?? null,
        });
        if (!res.ok || !res.data) {
          setExpenseDraftError(res.error ?? "Failed to save");
          return { ok: false, error: res.error };
        }
        const newRow: ExpenseRow = {
          id: res.data.id,
          date: res.data.date,
          category: res.data.category,
          description: res.data.description,
          amount: Number(res.data.amount),
          notes: res.data.notes,
        };
        setExpenseRows((rows) => sortByDateDesc([...rows, newRow]));
        setExpenseDraft(emptyExpenseDraft());
        setExpenseDraftKey(`draft-${crypto.randomUUID()}`);
        return { ok: true };
      } finally {
        setExpenseDraftSaving(false);
      }
    },
    [expenseDraft, expenseDraftSaving]
  );

  // ---------- mileage ----------

  const handleMileageUpdate = useCallback(
    async (
      rowId: string,
      patch: Partial<MileageRow>
    ): Promise<CommitResult> => {
      const before = mileageRows.find((r) => r.id === rowId);
      if (!before) return { ok: false, error: "Row not found" };

      // Compute deduction client-side so the Deduction column stays accurate
      // when miles changes. ratePerMile is a write-time snapshot — never
      // touched here.
      const optimisticPatch: Partial<MileageRow> = { ...patch };
      if (patch.miles !== undefined) {
        optimisticPatch.deduction = patch.miles * before.ratePerMile;
      }

      const revertPatch: Partial<MileageRow> = {};
      for (const k of Object.keys(optimisticPatch) as Array<keyof MileageRow>) {
        (revertPatch as Record<string, unknown>)[k] = before[k];
      }

      setMileageRows((rows) =>
        rows.map((r) =>
          r.id === rowId ? { ...r, ...optimisticPatch } : r
        )
      );

      const actionPatch: UpdateMileageLogInput = {};
      if (patch.date !== undefined) actionPatch.trip_date = patch.date;
      if (patch.fromAddress !== undefined) {
        actionPatch.from_address = patch.fromAddress;
      }
      if (patch.toAddress !== undefined) {
        actionPatch.to_address = patch.toAddress;
      }
      if (patch.miles !== undefined) actionPatch.miles = patch.miles;

      const res = await updateMileageLogAction(rowId, actionPatch);
      if (!res.ok) {
        setMileageRows((rows) =>
          rows.map((r) => (r.id === rowId ? { ...r, ...revertPatch } : r))
        );
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    [mileageRows]
  );

  const handleMileageDelete = useCallback(
    async (rowId: string): Promise<CommitResult> => {
      const idx = mileageRows.findIndex((r) => r.id === rowId);
      if (idx === -1) return { ok: false, error: "Row not found" };
      const row = mileageRows[idx];
      setMileageRows((rows) => rows.filter((r) => r.id !== rowId));

      const res = await deleteMileageLogAction(rowId);
      if (!res.ok) {
        setMileageRows((rows) => {
          const next = [...rows];
          next.splice(Math.min(idx, next.length), 0, row);
          return next;
        });
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    [mileageRows]
  );

  // ---------- suggestion accept / dismiss ----------
  //
  // Accept flow: optimistic-remove → call action → on success splice the
  // returned record (mapped to the display row shape) into the rows state
  // via sortByDateDesc; on failure restore the suggestion at the front of
  // its array (position within the array isn't semantically meaningful —
  // the tables re-sort by date) and surface the error in the shared banner.
  //
  // Dismiss flow: optimistic-remove → fire dismissSuggestionAction →
  // restore + banner on failure. No corresponding rows-state insert.

  const handleIncomeSuggestionAccept = useCallback(
    async (sug: IncomeSuggestion): Promise<CommitResult> => {
      setIncomeSugState((s) =>
        s.filter((x) => x.referenceId !== sug.referenceId)
      );
      const res = await acceptIncomeSuggestionAction({
        payment_date: sug.suggestedDate,
        client_id: sug.clientId,
        client_name_snapshot: sug.clientName,
        amount: sug.amount,
        income_type: sug.incomeType,
        payment_method: sug.paymentMethod ?? null,
        notes: sug.notes ?? null,
      });
      if (!res.ok || !res.data) {
        setIncomeSugState((s) =>
          s.some((x) => x.referenceId === sug.referenceId) ? s : [sug, ...s]
        );
        setSugError(res.error ?? "Could not accept suggestion");
        return { ok: false, error: res.error };
      }
      const newRow: IncomeRow = {
        id: res.data.id,
        date: res.data.payment_date,
        clientName: res.data.client_name_snapshot,
        incomeType: res.data.income_type,
        amount: Number(res.data.amount),
        paymentMethod: res.data.payment_method,
        notes: res.data.notes,
      };
      setIncomeRows((rows) => sortByDateDesc([...rows, newRow]));
      return { ok: true };
    },
    []
  );
  const handleIncomeSuggestionDismiss = useCallback(
    async (sug: IncomeSuggestion): Promise<CommitResult> => {
      setIncomeSugState((s) =>
        s.filter((x) => x.referenceId !== sug.referenceId)
      );
      const res = await dismissSuggestionAction({
        type: "income_retainer",
        reference_id: sug.referenceId,
        period_yyyymm: sug.periodYyyymm,
      });
      if (!res.ok) {
        setIncomeSugState((s) =>
          s.some((x) => x.referenceId === sug.referenceId) ? s : [sug, ...s]
        );
        setSugError(res.error ?? "Could not dismiss suggestion");
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    []
  );

  const handleExpenseSuggestionAccept = useCallback(
    async (sug: ExpenseSuggestion): Promise<CommitResult> => {
      setExpenseSugState((s) =>
        s.filter((x) => x.referenceId !== sug.referenceId)
      );
      const res = await acceptExpenseSuggestionAction({
        date: sug.suggestedDate,
        category: sug.category,
        amount: sug.amount,
        source_template_id: sug.templateId,
        description: sug.name,
        notes: sug.notes ?? null,
      });
      if (!res.ok || !res.data) {
        setExpenseSugState((s) =>
          s.some((x) => x.referenceId === sug.referenceId) ? s : [sug, ...s]
        );
        setSugError(res.error ?? "Could not accept suggestion");
        return { ok: false, error: res.error };
      }
      const newRow: ExpenseRow = {
        id: res.data.id,
        date: res.data.date,
        category: res.data.category,
        description: res.data.description,
        amount: Number(res.data.amount),
        notes: res.data.notes,
      };
      setExpenseRows((rows) => sortByDateDesc([...rows, newRow]));
      return { ok: true };
    },
    []
  );
  const handleExpenseSuggestionDismiss = useCallback(
    async (sug: ExpenseSuggestion): Promise<CommitResult> => {
      setExpenseSugState((s) =>
        s.filter((x) => x.referenceId !== sug.referenceId)
      );
      const res = await dismissSuggestionAction({
        type: "expense_template",
        reference_id: sug.referenceId,
        period_yyyymm: sug.periodYyyymm,
      });
      if (!res.ok) {
        setExpenseSugState((s) =>
          s.some((x) => x.referenceId === sug.referenceId) ? s : [sug, ...s]
        );
        setSugError(res.error ?? "Could not dismiss suggestion");
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    []
  );

  const handleMileageSuggestionAccept = useCallback(
    async (sug: MileageSuggestion): Promise<CommitResult> => {
      // Mileage is the only accept that takes long enough to show a
      // "Calculating…" state — keep the suggestion rendered (and the
      // table-level `sugInFlight` flag set) until the Distance Matrix
      // call resolves. The other two accepts can remove optimistically
      // because their actions are fast and there's no in-row indicator
      // to preserve.
      const res = await acceptMileageSuggestionAction({
        trip_date: sug.tripDate,
        from_address: sug.fromAddress,
        to_address: sug.toAddress,
        source_shoot_id: sug.shootId,
        client_id: sug.clientId || null,
      });
      if (!res.ok || !res.data) {
        setSugError(res.error ?? "Could not accept suggestion");
        return { ok: false, error: res.error };
      }
      setMileageSugState((s) =>
        s.filter((x) => x.referenceId !== sug.referenceId)
      );
      const miles = Number(res.data.miles);
      const ratePerMile = Number(res.data.rate_per_mile);
      const newRow: MileageRow = {
        id: res.data.id,
        date: res.data.trip_date,
        fromAddress: res.data.from_address,
        toAddress: res.data.to_address,
        miles,
        ratePerMile,
        deduction: miles * ratePerMile,
        clientName: sug.clientName || null,
      };
      setMileageRows((rows) => sortByDateDesc([...rows, newRow]));
      return { ok: true };
    },
    []
  );
  const handleMileageSuggestionDismiss = useCallback(
    async (sug: MileageSuggestion): Promise<CommitResult> => {
      setMileageSugState((s) =>
        s.filter((x) => x.referenceId !== sug.referenceId)
      );
      const res = await dismissSuggestionAction({
        type: "mileage_shoot",
        reference_id: sug.referenceId,
        period_yyyymm: sug.periodYyyymm,
      });
      if (!res.ok) {
        setMileageSugState((s) =>
          s.some((x) => x.referenceId === sug.referenceId) ? s : [sug, ...s]
        );
        setSugError(res.error ?? "Could not dismiss suggestion");
        return { ok: false, error: res.error };
      }
      return { ok: true };
    },
    []
  );

  const handleMileageDraftFieldChange = useCallback(
    async <K extends keyof DraftMileageRow>(
      field: K,
      value: DraftMileageRow[K]
    ): Promise<CommitResult> => {
      if (mileageDraftSaving) return { ok: false, error: "Saving…" };
      const next: DraftMileageRow = { ...mileageDraft, [field]: value };
      setMileageDraft(next);
      setMileageDraftError(null);
      if (!isMileageDraftComplete(next)) return { ok: true };

      setMileageDraftSaving(true);
      try {
        const res = await addMileageLogAction({
          trip_date: next.date!,
          from_address: next.fromAddress!.trim(),
          to_address: next.toAddress!.trim(),
          miles: next.miles!,
        });
        if (!res.ok || !res.data) {
          setMileageDraftError(res.error ?? "Failed to save");
          return { ok: false, error: res.error };
        }
        const miles = Number(res.data.miles);
        const ratePerMile = Number(res.data.rate_per_mile);
        const newRow: MileageRow = {
          id: res.data.id,
          date: res.data.trip_date,
          fromAddress: res.data.from_address,
          toAddress: res.data.to_address,
          miles,
          ratePerMile,
          deduction: miles * ratePerMile,
          clientName: null,
        };
        setMileageRows((rows) => sortByDateDesc([...rows, newRow]));
        setMileageDraft(emptyMileageDraft());
        setMileageDraftKey(`draft-${crypto.randomUUID()}`);
        return { ok: true };
      } finally {
        setMileageDraftSaving(false);
      }
    },
    [mileageDraft, mileageDraftSaving]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {sugError && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 12px",
            border: "1px solid var(--status-danger)",
            background: "rgba(122,48,64,0.08)",
            color: "var(--status-danger)",
            fontSize: 13,
          }}
        >
          <span>{sugError}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setSugError(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--status-danger)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className="financials-summary-grid">
        <StatCard
          label="Total Income"
          value={formatCurrency(summary.income)}
          icon={<IconIncome size={28} />}
        />
        <StatCard
          label="Total Expenses"
          value={formatCurrency(summary.expenses)}
          icon={<IconExpenses size={28} />}
        />
        <StatCard
          label="Net Profit"
          value={formatCurrency(summary.netProfit)}
          tone={summary.netProfit < 0 ? "danger" : "success"}
          icon={<IconWallet size={28} />}
        />
        <StatCard
          label={`Tax Set-Aside (${summary.taxRatePercent}%)`}
          value={formatCurrency(summary.taxSetAside)}
          tone="muted"
          icon={<IconTax size={28} />}
        />
        <StatCard
          label="Est. Take-Home"
          value={formatCurrency(summary.takeHome)}
          tone={summary.takeHome > 0 ? "success" : "default"}
          icon={<IconPiggyBank size={28} />}
        />
      </div>

      <div className="financials-main-grid">
        <DashboardCard eyebrow="INCOME" title="Payments received">
          <IncomeTable
            rows={incomeRows}
            onUpdate={handleIncomeUpdate}
            onDelete={handleIncomeDelete}
            draft={incomeDraft}
            draftKey={incomeDraftKey}
            draftSaving={incomeDraftSaving}
            draftError={incomeDraftError}
            onDraftFieldChange={handleIncomeDraftFieldChange}
            suggestions={incomeSugState}
            onSuggestionAccept={handleIncomeSuggestionAccept}
            onSuggestionDismiss={handleIncomeSuggestionDismiss}
          />
        </DashboardCard>

        <DashboardCard eyebrow="EXPENSES" title="Expenses logged">
          <ExpenseTable
            rows={expenseRows}
            onUpdate={handleExpenseUpdate}
            onDelete={handleExpenseDelete}
            draft={expenseDraft}
            draftKey={expenseDraftKey}
            draftSaving={expenseDraftSaving}
            draftError={expenseDraftError}
            onDraftFieldChange={handleExpenseDraftFieldChange}
            suggestions={expenseSugState}
            onSuggestionAccept={handleExpenseSuggestionAccept}
            onSuggestionDismiss={handleExpenseSuggestionDismiss}
          />
        </DashboardCard>

        <DashboardCard eyebrow="MILEAGE" title="Trips logged">
          <MileageTable
            rows={mileageRows}
            onUpdate={handleMileageUpdate}
            onDelete={handleMileageDelete}
            draft={mileageDraft}
            draftKey={mileageDraftKey}
            draftSaving={mileageDraftSaving}
            draftError={mileageDraftError}
            onDraftFieldChange={handleMileageDraftFieldChange}
            suggestions={mileageSugState}
            onSuggestionAccept={handleMileageSuggestionAccept}
            onSuggestionDismiss={handleMileageSuggestionDismiss}
          />
        </DashboardCard>

        <div className="financials-insights-pair">
          <BreakdownPanel summary={summary} />
          <InsightsPanel
            summary={summary}
            pendingSuggestionsCount={
              incomeSugState.length +
              expenseSugState.length +
              mileageSugState.length
            }
            incomeCount={incomeRows.length}
            expenseCount={expenseRows.length}
          />
        </div>
      </div>

      <style>{`
        .financials-summary-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 16px;
        }
        @media (max-width: 900px) {
          .financials-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 480px) {
          .financials-summary-grid { grid-template-columns: 1fr; }
        }
        .financials-main-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }
        @media (max-width: 1280px) {
          .financials-main-grid { grid-template-columns: 1fr; }
        }
        .financials-insights-pair {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 1280px) {
          .financials-insights-pair { grid-template-columns: 1fr; }
        }
        .fb-row:hover td { background-color: var(--surface-base); }

        .fb-cell-display {
          border-color: transparent;
          transition: border-color 0.1s;
        }
        .fb-cell-display:hover { border-color: var(--border); }
        .fb-cell-display:focus { border-color: var(--accent); outline: none; }
        .fb-cell-display.fb-cell-error { border-color: var(--status-danger); }
        .fb-cell-display.fb-cell-error:hover { border-color: var(--status-danger); }
        .fb-cell-display-empty {
          font-style: italic;
          color: var(--text-muted);
        }

        .fb-row-saving {
          opacity: 0.85;
          pointer-events: none;
        }
        .fb-row-ghost-placeholder {
          font-style: italic;
          color: var(--text-muted);
          padding: 14px 16px;
          font-size: 14px;
        }

        .fb-row-delete {
          width: 24px;
          height: 24px;
          padding: 0;
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.1s, color 0.1s;
        }
        .fb-row:hover .fb-row-delete { opacity: 1; }
        .fb-row-delete:focus { opacity: 1; outline: none; color: var(--status-danger); }
        .fb-row-delete:hover { color: var(--status-danger); }

        /* Suggestion ghost rows. */
        .fb-row-suggestion td {
          background-color: color-mix(in srgb, var(--accent) 6%, var(--surface-base));
        }
        .fb-row-suggestion:hover td {
          background-color: color-mix(in srgb, var(--accent) 10%, var(--surface-base));
        }
        .fb-suggestion-actions {
          display: inline-flex;
          gap: 4px;
          padding-right: 6px;
        }
        .fb-suggestion-btn {
          width: 24px;
          height: 24px;
          padding: 0;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-muted);
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
          transition: color 0.1s, border-color 0.1s;
        }
        .fb-suggestion-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .fb-suggestion-btn-accept:hover:not(:disabled),
        .fb-suggestion-btn-accept:focus:not(:disabled) {
          color: var(--accent);
          border-color: var(--accent);
          outline: none;
        }
        .fb-suggestion-btn-dismiss:hover:not(:disabled),
        .fb-suggestion-btn-dismiss:focus:not(:disabled) {
          color: var(--status-danger);
          border-color: var(--status-danger);
          outline: none;
        }
      `}</style>
    </div>
  );
}
