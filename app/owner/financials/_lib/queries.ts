import { cache } from "react";
import {
  getSupabaseServiceClient,
  type AppSettingsRecord,
  type CashTaxClass,
  type ClientRecord,
  type ExpenseCategory,
  type ExpenseRecord,
  type IncomePaymentRecord,
  type IncomeType,
  type MileageLogRecord,
} from "@/lib/supabase";

/**
 * Request-scoped read of the app_settings singleton row. Wrapping in
 * React's `cache()` collapses the three callers (summary fetch, mileage
 * action, suggestion compute) into one round trip per render. Mirrors
 * the pattern in `app/owner/clients/_lib/queries.ts:fetchClientsWithRelations`.
 *
 * Returns a defaults sentinel if the singleton row is missing
 * (greenfield-safe). The defaults match the schema's column defaults
 * (`supabase/schema.sql:243-247`): `mileage_rate_per_mile = 0.70`,
 * `tax_set_aside_percent = 28`, `home_address = ''`. An empty
 * home_address triggers the existing guard in
 * `computeMileageSuggestions` so mileage suggestions become an empty
 * array — the correct fallback before Kelsey has entered her address.
 *
 * Still throws on Supabase infrastructure errors — that's a genuine
 * failure callers should bubble up.
 */
export const fetchAppSettings = cache(async (): Promise<AppSettingsRecord> => {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return {
      id: "default",
      singleton: true,
      home_address: "",
      mileage_rate_per_mile: 0.7,
      tax_set_aside_percent: 28,
      updated_at: new Date().toISOString(),
    } satisfies AppSettingsRecord;
  }
  return data as AppSettingsRecord;
});

export type FinancialsRange = {
  start: string;
  end: string;
  label: string;
};

export type IncomeRow = {
  id: string;
  date: string;
  clientName: string;
  incomeType: IncomeType;
  amount: number;
  paymentMethod: string | null;
  notes: string | null;
};

export type ExpenseRow = {
  id: string;
  date: string;
  category: ExpenseCategory;
  description: string | null;
  amount: number;
  notes: string | null;
  cashTaxClass: CashTaxClass;
};

export type MileageRow = {
  id: string;
  date: string;
  fromAddress: string;
  toAddress: string;
  miles: number;
  ratePerMile: number;
  deduction: number;
  clientName: string | null;
};

export type FinancialsSummary = {
  income: number;
  /** Tax-side total: deductibleExpenses + mileageDeduction. Feeds "Total deductible expenses". */
  expenses: number;
  /** Rows classed both | cash_only — money that left the account this period. */
  cashExpenses: number;
  /** Rows classed both | tax_only — Schedule C deductible pool (excl. mileage). */
  deductibleExpenses: number;
  /**
   * tax_only rows alone (prior-year equipment). Drives the "excludes
   * $X equipment paid in 2025" footnote on the cash card — 0 in ranges
   * that don't contain those rows, which hides the footnote.
   */
  taxOnlyExpenses: number;
  taxableProfit: number;
  taxSetAside: number;
  netCashRetained: number;
  taxRatePercent: number;
};

export type FinancialsData = {
  range: FinancialsRange;
  summary: FinancialsSummary;
  incomeRows: IncomeRow[];
  expenseRows: ExpenseRow[];
  mileageRows: MileageRow[];
};

export const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  brand_retainer: "Brand Retainer",
  wedding_same_day: "Wedding / Same-Day Content",
  one_off_shoot: "One-Off Shoot",
  other: "Other Income",
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  platform_software: "Platform & Software",
  marketing_advertising: "Marketing & Advertising",
  equipment_gear: "Equipment & Gear",
  travel_transportation: "Travel & Transportation",
  professional_services: "Professional Services",
  business_operations: "Business Operations",
};

export const CASH_TAX_CLASS_LABELS: Record<CashTaxClass, string> = {
  both: "Cash + tax",
  tax_only: "Tax only (no cash this year)",
  cash_only: "Cash only (not deductible)",
};

export async function fetchFinancialsForRange(
  range: FinancialsRange
): Promise<FinancialsData> {
  const supabase = getSupabaseServiceClient();

  const [incomeRes, expenseRes, mileageRes, settings] = await Promise.all([
    supabase
      .from("income_payments")
      .select(
        "id, payment_date, client_name_snapshot, income_type, amount, payment_method, notes, created_at"
      )
      .gte("payment_date", range.start)
      .lte("payment_date", range.end)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("expenses")
      .select(
        "id, date, category, description, amount, notes, cash_tax_class, created_at"
      )
      .gte("date", range.start)
      .lte("date", range.end)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("mileage_logs")
      .select(
        "id, trip_date, from_address, to_address, miles, rate_per_mile, client_id, created_at"
      )
      .gte("trip_date", range.start)
      .lte("trip_date", range.end)
      .order("trip_date", { ascending: false })
      .order("created_at", { ascending: false }),
    fetchAppSettings(),
  ]);

  if (incomeRes.error) throw new Error(incomeRes.error.message);
  if (expenseRes.error) throw new Error(expenseRes.error.message);
  if (mileageRes.error) throw new Error(mileageRes.error.message);

  const taxRatePercent = Number(settings.tax_set_aside_percent);

  const incomeRaw = (incomeRes.data ?? []) as Array<
    Pick<
      IncomePaymentRecord,
      | "id"
      | "payment_date"
      | "client_name_snapshot"
      | "income_type"
      | "amount"
      | "payment_method"
      | "notes"
    >
  >;

  // income_payments stores `client_name_snapshot` so the display name is
  // already resolved at write time — no second client query needed here.
  // mileage_logs has no snapshot column, so it gets the lookup pattern below.
  const incomeRows: IncomeRow[] = incomeRaw.map((r) => ({
    id: r.id,
    date: r.payment_date,
    clientName: r.client_name_snapshot,
    incomeType: r.income_type,
    amount: Number(r.amount),
    paymentMethod: r.payment_method,
    notes: r.notes,
  }));

  const expenseRaw = (expenseRes.data ?? []) as Array<
    Pick<
      ExpenseRecord,
      | "id"
      | "date"
      | "category"
      | "description"
      | "amount"
      | "notes"
      | "cash_tax_class"
    >
  >;
  const expenseRows: ExpenseRow[] = expenseRaw.map((r) => ({
    id: r.id,
    date: r.date,
    category: r.category,
    description: r.description,
    amount: Number(r.amount),
    notes: r.notes,
    cashTaxClass: r.cash_tax_class,
  }));

  const mileageRaw = (mileageRes.data ?? []) as Array<
    Pick<
      MileageLogRecord,
      | "id"
      | "trip_date"
      | "from_address"
      | "to_address"
      | "miles"
      | "rate_per_mile"
      | "client_id"
    >
  >;

  // Resolve client names for mileage rows via a second query. Mirrors the
  // local pattern used by app/owner/time/_lib/queries.ts — kept inline on
  // purpose rather than factored to a shared helper.
  const mileageClientIds = Array.from(
    new Set(
      mileageRaw
        .map((r) => r.client_id)
        .filter((id): id is string => id !== null)
    )
  );
  const mileageClientNameById = new Map<string, string>();
  if (mileageClientIds.length > 0) {
    const { data: clientRows, error: clientError } = await supabase
      .from("clients")
      .select("id, name")
      .in("id", mileageClientIds);
    if (clientError) throw new Error(clientError.message);
    for (const row of (clientRows ?? []) as Pick<
      ClientRecord,
      "id" | "name"
    >[]) {
      mileageClientNameById.set(row.id, row.name);
    }
  }

  const mileageRows: MileageRow[] = mileageRaw.map((r) => {
    const miles = Number(r.miles);
    const ratePerMile = Number(r.rate_per_mile);
    return {
      id: r.id,
      date: r.trip_date,
      fromAddress: r.from_address,
      toAddress: r.to_address,
      miles,
      ratePerMile,
      deduction: miles * ratePerMile,
      clientName:
        r.client_id !== null
          ? mileageClientNameById.get(r.client_id) ?? null
          : null,
    };
  });

  const income = incomeRows.reduce((sum, r) => sum + r.amount, 0);
  // Two-pool split on cash_tax_class (migration 013): tax_only rows are
  // prior-year cash (deductible now, no money out this period); cash_only
  // rows are the reverse (money out, not separately deductible — e.g. gas
  // under the standard-mileage election).
  const cashExpenses = expenseRows.reduce(
    (sum, r) =>
      r.cashTaxClass === "both" || r.cashTaxClass === "cash_only"
        ? sum + r.amount
        : sum,
    0
  );
  const deductibleExpenses = expenseRows.reduce(
    (sum, r) =>
      r.cashTaxClass === "both" || r.cashTaxClass === "tax_only"
        ? sum + r.amount
        : sum,
    0
  );
  const taxOnlyExpenses = expenseRows.reduce(
    (sum, r) => (r.cashTaxClass === "tax_only" ? sum + r.amount : sum),
    0
  );
  const mileageDeduction = mileageRows.reduce((sum, r) => sum + r.deduction, 0);
  const expenses = deductibleExpenses + mileageDeduction;
  const taxableProfit = income - deductibleExpenses - mileageDeduction;
  const taxSetAside = (taxRatePercent / 100) * Math.max(taxableProfit, 0);
  // Mileage reduces taxes owed (via taxableProfit/taxSetAside above) but does
  // not leave the bank account — intentionally excluded from cash retained.
  const netCashRetained = income - cashExpenses - taxSetAside;

  return {
    range,
    summary: {
      income,
      expenses,
      cashExpenses,
      deductibleExpenses,
      taxOnlyExpenses,
      taxableProfit,
      taxSetAside,
      netCashRetained,
      taxRatePercent,
    },
    incomeRows,
    expenseRows,
    mileageRows,
  };
}
