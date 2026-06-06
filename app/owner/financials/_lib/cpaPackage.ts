/**
 * CPA Financial Package — aggregation layer (Phase 1).
 *
 * Source of truth: docs/cpa-financial-package-feature.md.
 *
 * This module regroups the EXISTING financials data into a CPA-/Schedule-C-
 * shaped structure. It is a pure read-only transform on top of
 * `fetchFinancialsForRange` (app/owner/financials/_lib/queries.ts) — it does
 * NOT re-query income_payments / expenses / mileage_logs, and it does NOT
 * recompute the per-row income/expense/mileage values. It reuses both the
 * underlying rows AND the computed `FinancialsSummary`, then layers the
 * CPA-specific groupings on top.
 *
 * The CPA groupings intentionally DIFFER from the on-screen Financials summary:
 *   - "Cash expenses" excludes equipment_gear (capital asset, own block) and
 *     mileage (a non-cash write-off, own block).
 *   - The 6 expense categories are mapped to Schedule C lines 8 / 17 / 24a /
 *     27a (§4 of the spec).
 *
 * Because both views derive from the same fetch, the two MUST reconcile. The
 * aggregator returns a `reconciliation` block (three equality checks) as DATA
 * — it never throws — plus the source `FinancialsSummary` so callers can
 * cross-check against the screen.
 */

import {
  fetchFinancialsForRange,
  EXPENSE_CATEGORY_LABELS,
  INCOME_TYPE_LABELS,
  type FinancialsRange,
  type FinancialsSummary,
} from "./queries";
import type { ExpenseCategory, IncomeType } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Schedule C mapping (spec §4)
//
// The five "cash" expense categories spread across four Schedule C lines.
// Line 27a combines two categories, each surfaced as its own sub-labeled
// group. equipment_gear is deliberately absent here — it lives in its own
// block and is never part of the deductible cash total.
// ---------------------------------------------------------------------------

export type ScheduleCLineId = "line_8" | "line_17" | "line_24a" | "line_27a";

interface ScheduleCLineConfig {
  lineId: ScheduleCLineId;
  /** The Schedule C line number as printed on the form, e.g. "24a". */
  lineNumber: string;
  /** The official Schedule C line name. */
  lineLabel: string;
  /** App expense categories that roll up to this line. */
  categories: ExpenseCategory[];
}

const SCHEDULE_C_LINES: ScheduleCLineConfig[] = [
  {
    lineId: "line_8",
    lineNumber: "8",
    lineLabel: "Advertising",
    categories: ["marketing_advertising"],
  },
  {
    lineId: "line_17",
    lineNumber: "17",
    lineLabel: "Legal & professional services",
    categories: ["professional_services"],
  },
  {
    lineId: "line_24a",
    lineNumber: "24a",
    lineLabel: "Travel",
    categories: ["travel_transportation"],
  },
  {
    lineId: "line_27a",
    lineNumber: "27a",
    lineLabel: "Other expenses",
    categories: ["platform_software", "business_operations"],
  },
];

/** Capital-asset category — itemized separately, never in the cash total. */
const EQUIPMENT_CATEGORY: ExpenseCategory = "equipment_gear";

/**
 * Currency-scale epsilon for reconciliation. Both sides of every check sum the
 * exact same source numbers; the only divergence is float-addition ordering,
 * which is well under a thousandth of a cent for realistic magnitudes.
 */
const RECONCILE_EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

export interface CpaIncomeRow {
  id: string;
  date: string;
  clientName: string;
  incomeType: IncomeType;
  incomeTypeLabel: string;
  amount: number;
}

export interface CpaIncomeTypeSubtotal {
  incomeType: IncomeType;
  label: string;
  subtotal: number;
  count: number;
}

export interface CpaClientSubtotal {
  clientName: string;
  subtotal: number;
  count: number;
}

export interface CpaIncomeSection {
  rows: CpaIncomeRow[];
  grossIncome: number;
  /** Subtotals per income_type, canonical order, present types only. */
  byIncomeType: CpaIncomeTypeSubtotal[];
  /** Optional per-client subtotals, largest first. */
  byClient: CpaClientSubtotal[];
}

export interface CpaExpenseItem {
  id: string;
  date: string;
  category: ExpenseCategory;
  categoryLabel: string;
  description: string | null;
  amount: number;
  /**
   * Whether a receipt is on file for this expense. `expenses.receipt_url` is
   * unused in practice (no upload UI) AND is not carried by the reused rows,
   * so this is always `false` today. Kept in the shape so the indicator
   * lights up once receipt upload ships.
   */
  receiptOnFile: boolean;
}

/** A category-level sub-group within a Schedule C line (used for 27a). */
export interface CpaExpenseSubGroup {
  category: ExpenseCategory;
  label: string;
  subtotal: number;
  rows: CpaExpenseItem[];
}

export interface CpaScheduleCLine {
  lineId: ScheduleCLineId;
  lineNumber: string;
  lineLabel: string;
  categories: ExpenseCategory[];
  subtotal: number;
  /** All rows on this line, date-ascending. */
  rows: CpaExpenseItem[];
  /** Per-category breakdown for sub-labeling (one entry per category). */
  subGroups: CpaExpenseSubGroup[];
}

export interface CpaExpensesSection {
  byScheduleCLine: CpaScheduleCLine[];
  /** Sum of the four mapped lines. Excludes equipment_gear and mileage. */
  totalDeductibleCashExpenses: number;
}

export interface CpaEquipmentRow {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  receiptOnFile: boolean;
}

export interface CpaEquipmentSection {
  rows: CpaEquipmentRow[];
  total: number;
}

export interface CpaMileageRow {
  id: string;
  date: string;
  fromAddress: string;
  toAddress: string;
  miles: number;
  /** Snapshot rate captured when the trip was logged. */
  ratePerMile: number;
  /** miles × ratePerMile using THIS row's snapshot rate. */
  amount: number;
  clientName: string | null;
}

export interface CpaMileageSection {
  rows: CpaMileageRow[];
  totalMiles: number;
  mileageDeduction: number;
  /** Distinct snapshot rates that appear across the trip log, ascending. */
  ratesApplied: number[];
}

export interface CpaSummary {
  grossIncome: number;
  totalDeductibleCashExpenses: number;
  /** grossIncome − totalDeductibleCashExpenses. */
  netCashProfit: number;
  equipmentTotal: number;
  mileageDeduction: number;
  /** netCashProfit − mileageDeduction (equipment NOT yet expensed). */
  estimatedTaxableIncome: number;
  /** estimatedTaxableIncome − equipmentTotal (equipment fully expensed). */
  estimatedTaxableIncomeIfEquipmentExpensed: number;
  /** Pulled straight from the reused FinancialsSummary so it matches screen. */
  taxSetAsidePercent: number;
  /** Pulled straight from the reused FinancialsSummary (base = net profit). */
  taxSetAsideReserve: number;
}

export interface CpaReconciliationCheck {
  label: string;
  cpaValue: number;
  summaryValue: number;
  delta: number;
  pass: boolean;
}

export interface CpaReconciliation {
  checks: CpaReconciliationCheck[];
  allPass: boolean;
}

export interface CpaPackageData {
  range: FinancialsRange;
  income: CpaIncomeSection;
  expenses: CpaExpensesSection;
  equipment: CpaEquipmentSection;
  mileage: CpaMileageSection;
  summary: CpaSummary;
  reconciliation: CpaReconciliation;
  /** The reused on-screen summary, returned alongside for cross-checking. */
  sourceSummary: FinancialsSummary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sum(values: number[]): number {
  return values.reduce((acc, n) => acc + n, 0);
}

/** Ascending by ISO date string ("YYYY-MM-DD"); stable for equal dates. */
function byDateAsc<T extends { date: string }>(a: T, b: T): number {
  return a.date.localeCompare(b.date);
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export async function aggregateCpaPackage(
  range: FinancialsRange
): Promise<CpaPackageData> {
  const data = await fetchFinancialsForRange(range);
  const { incomeRows, expenseRows, mileageRows } = data;
  const sourceSummary = data.summary;

  // ---- Income --------------------------------------------------------------
  const cpaIncomeRows: CpaIncomeRow[] = [...incomeRows]
    .sort(byDateAsc)
    .map((r) => ({
      id: r.id,
      date: r.date,
      clientName: r.clientName,
      incomeType: r.incomeType,
      incomeTypeLabel: INCOME_TYPE_LABELS[r.incomeType],
      amount: r.amount,
    }));
  const grossIncome = sum(cpaIncomeRows.map((r) => r.amount));

  const byIncomeType: CpaIncomeTypeSubtotal[] = (
    Object.keys(INCOME_TYPE_LABELS) as IncomeType[]
  )
    .map((incomeType) => {
      const rows = cpaIncomeRows.filter((r) => r.incomeType === incomeType);
      return {
        incomeType,
        label: INCOME_TYPE_LABELS[incomeType],
        subtotal: sum(rows.map((r) => r.amount)),
        count: rows.length,
      };
    })
    .filter((group) => group.count > 0);

  const clientTotals = new Map<string, { subtotal: number; count: number }>();
  for (const r of cpaIncomeRows) {
    const current = clientTotals.get(r.clientName) ?? { subtotal: 0, count: 0 };
    current.subtotal += r.amount;
    current.count += 1;
    clientTotals.set(r.clientName, current);
  }
  const byClient: CpaClientSubtotal[] = Array.from(clientTotals.entries())
    .map(([clientName, v]) => ({
      clientName,
      subtotal: v.subtotal,
      count: v.count,
    }))
    .sort(
      (a, b) => b.subtotal - a.subtotal || a.clientName.localeCompare(b.clientName)
    );

  const income: CpaIncomeSection = {
    rows: cpaIncomeRows,
    grossIncome,
    byIncomeType,
    byClient,
  };

  // ---- Expenses (Schedule C lines) + Equipment block -----------------------
  // Build the full set of CPA expense items once, indexed by category, so each
  // Schedule C line and the equipment block draw from the same source rows.
  const itemsByCategory = new Map<ExpenseCategory, CpaExpenseItem[]>();
  for (const r of [...expenseRows].sort(byDateAsc)) {
    const item: CpaExpenseItem = {
      id: r.id,
      date: r.date,
      category: r.category,
      categoryLabel: EXPENSE_CATEGORY_LABELS[r.category],
      description: r.description,
      amount: r.amount,
      receiptOnFile: false,
    };
    const bucket = itemsByCategory.get(r.category);
    if (bucket) bucket.push(item);
    else itemsByCategory.set(r.category, [item]);
  }

  const byScheduleCLine: CpaScheduleCLine[] = SCHEDULE_C_LINES.map((cfg) => {
    const subGroups: CpaExpenseSubGroup[] = cfg.categories.map((category) => {
      const rows = itemsByCategory.get(category) ?? [];
      return {
        category,
        label: EXPENSE_CATEGORY_LABELS[category],
        subtotal: sum(rows.map((r) => r.amount)),
        rows,
      };
    });
    const rows = cfg.categories
      .flatMap((category) => itemsByCategory.get(category) ?? [])
      .sort(byDateAsc);
    return {
      lineId: cfg.lineId,
      lineNumber: cfg.lineNumber,
      lineLabel: cfg.lineLabel,
      categories: cfg.categories,
      subtotal: sum(subGroups.map((g) => g.subtotal)),
      rows,
      subGroups,
    };
  });

  const totalDeductibleCashExpenses = sum(
    byScheduleCLine.map((line) => line.subtotal)
  );
  const expenses: CpaExpensesSection = {
    byScheduleCLine,
    totalDeductibleCashExpenses,
  };

  const equipmentRows: CpaEquipmentRow[] = (
    itemsByCategory.get(EQUIPMENT_CATEGORY) ?? []
  ).map((item) => ({
    id: item.id,
    date: item.date,
    description: item.description,
    amount: item.amount,
    receiptOnFile: item.receiptOnFile,
  }));
  const equipmentTotal = sum(equipmentRows.map((r) => r.amount));
  const equipment: CpaEquipmentSection = {
    rows: equipmentRows,
    total: equipmentTotal,
  };

  // ---- Mileage -------------------------------------------------------------
  // Deduction is summed per row using each row's snapshot rate_per_mile so a
  // mid-year IRS rate change doesn't retroactively re-price old trips.
  const cpaMileageRows: CpaMileageRow[] = [...mileageRows]
    .sort(byDateAsc)
    .map((r) => ({
      id: r.id,
      date: r.date,
      fromAddress: r.fromAddress,
      toAddress: r.toAddress,
      miles: r.miles,
      ratePerMile: r.ratePerMile,
      amount: r.miles * r.ratePerMile,
      clientName: r.clientName,
    }));
  const totalMiles = sum(cpaMileageRows.map((r) => r.miles));
  const mileageDeduction = sum(cpaMileageRows.map((r) => r.amount));
  const ratesApplied = Array.from(
    new Set(cpaMileageRows.map((r) => r.ratePerMile))
  ).sort((a, b) => a - b);
  const mileage: CpaMileageSection = {
    rows: cpaMileageRows,
    totalMiles,
    mileageDeduction,
    ratesApplied,
  };

  // ---- Summary block -------------------------------------------------------
  const netCashProfit = grossIncome - totalDeductibleCashExpenses;
  const estimatedTaxableIncome = netCashProfit - mileageDeduction;
  const estimatedTaxableIncomeIfEquipmentExpensed =
    estimatedTaxableIncome - equipmentTotal;
  const summary: CpaSummary = {
    grossIncome,
    totalDeductibleCashExpenses,
    netCashProfit,
    equipmentTotal,
    mileageDeduction,
    estimatedTaxableIncome,
    estimatedTaxableIncomeIfEquipmentExpensed,
    taxSetAsidePercent: sourceSummary.taxRatePercent,
    taxSetAsideReserve: sourceSummary.taxSetAside,
  };

  // ---- Reconciliation against the reused on-screen summary -----------------
  // a) gross income matches
  // b) cash + equipment + mileage matches summary.expenses
  //    (summary.expenses already folds mileage into its total)
  // c) taxable income with equipment expensed matches summary.netProfit
  const reconciliation = buildReconciliation([
    {
      label: "Gross income === summary income",
      cpaValue: grossIncome,
      summaryValue: sourceSummary.income,
    },
    {
      label:
        "Cash expenses + equipment + mileage === summary expenses",
      cpaValue:
        totalDeductibleCashExpenses + equipmentTotal + mileageDeduction,
      summaryValue: sourceSummary.expenses,
    },
    {
      label:
        "Estimated taxable income (equipment expensed) === summary net profit",
      cpaValue: estimatedTaxableIncomeIfEquipmentExpensed,
      summaryValue: sourceSummary.netProfit,
    },
  ]);

  return {
    range,
    income,
    expenses,
    equipment,
    mileage,
    summary,
    reconciliation,
    sourceSummary,
  };
}

function buildReconciliation(
  inputs: Array<Pick<CpaReconciliationCheck, "label" | "cpaValue" | "summaryValue">>
): CpaReconciliation {
  const checks: CpaReconciliationCheck[] = inputs.map((c) => {
    const delta = c.cpaValue - c.summaryValue;
    return {
      ...c,
      delta,
      pass: Math.abs(delta) <= RECONCILE_EPSILON,
    };
  });
  return { checks, allPass: checks.every((c) => c.pass) };
}
