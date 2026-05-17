import { cache } from "react";
import {
  getSupabaseServiceClient,
  type AppSettingsRecord,
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
 * Throws on Supabase error or missing singleton. Server-action callers
 * that need a `{ ok, error }` envelope should catch.
 */
export const fetchAppSettings = cache(async (): Promise<AppSettingsRecord> => {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("app_settings row not found");
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
  expenses: number;
  netProfit: number;
  taxSetAside: number;
  takeHome: number;
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
      .select("id, date, category, description, amount, notes, created_at")
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
      "id" | "date" | "category" | "description" | "amount" | "notes"
    >
  >;
  const expenseRows: ExpenseRow[] = expenseRaw.map((r) => ({
    id: r.id,
    date: r.date,
    category: r.category,
    description: r.description,
    amount: Number(r.amount),
    notes: r.notes,
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
  const expensesFromTable = expenseRows.reduce((sum, r) => sum + r.amount, 0);
  const mileageDeduction = mileageRows.reduce((sum, r) => sum + r.deduction, 0);
  const expenses = expensesFromTable + mileageDeduction;
  const netProfit = income - expenses;
  const taxSetAside = netProfit > 0 ? netProfit * (taxRatePercent / 100) : 0;
  const takeHome = netProfit - taxSetAside;

  return {
    range,
    summary: {
      income,
      expenses,
      netProfit,
      taxSetAside,
      takeHome,
      taxRatePercent,
    },
    incomeRows,
    expenseRows,
    mileageRows,
  };
}
