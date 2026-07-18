/**
 * Server-side suggestion computation.
 *
 * Three pure compute functions (income / expense / mileage) plus a
 * single `fetchSuggestionInputs()` orchestrator that gathers all of
 * their inputs in one round of parallel Supabase queries. The page
 * calls fetch + compute and passes the resulting arrays to
 * `<FinancialsBoard />` as props.
 *
 * Suggestions are scoped to a single calendar month (PORTAL_TIMEZONE);
 * the page suppresses suggestions entirely when range='ytd'.
 */

import {
  fetchClientsWithRelations,
  type ClientWithRelations,
} from "@/app/owner/clients/_lib/queries";
import { dateKeyInTimezone } from "@/lib/date";
import {
  getSupabaseServiceClient,
  type DismissedSuggestionRecord,
  type ExpenseCategory,
  type ExpenseRecord,
  type IncomePaymentRecord,
  type IncomeType,
  type MileageLogRecord,
  type RecurringExpenseTemplateRecord,
  type ShootRecord,
} from "@/lib/supabase";
import { fetchAppSettings } from "./queries";
import { effectiveMonthlyPrice } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Public suggestion shapes — each one carries the originating record's id
// as `referenceId` so the accept/dismiss actions can route by it.
// ---------------------------------------------------------------------------

export interface IncomeSuggestion {
  type: "income_retainer";
  referenceId: string;
  clientId: string;
  clientName: string;
  /**
   * Defaults to `brand_retainer` (the suggestion exists *because* a retainer
   * is expected). Widened to the full `IncomeType` union so the
   * suggestion row's type dropdown can edit it before accepting.
   */
  incomeType: IncomeType;
  amount: number;
  /** YYYY-MM-DD — defaults to the 1st of `periodYyyymm`. */
  suggestedDate: string;
  periodYyyymm: string;
  /** Optional overlay state for the suggestion-row Method cell (pre-accept). */
  paymentMethod?: string | null;
  /** Optional overlay state for the suggestion-row Notes cell (pre-accept). */
  notes?: string | null;
}

export interface ExpenseSuggestion {
  type: "expense_template";
  referenceId: string;
  templateId: string;
  name: string;
  category: ExpenseCategory;
  amount: number;
  /** YYYY-MM-DD — `periodYyyymm` + the template's `day_of_month`. */
  suggestedDate: string;
  periodYyyymm: string;
  /** Optional overlay state for the suggestion-row Notes cell (pre-accept). */
  notes?: string | null;
}

export interface MileageSuggestion {
  type: "mileage_shoot";
  referenceId: string;
  shootId: string;
  clientId: string;
  clientName: string;
  /** Snapshot of `app_settings.home_address` at compute time. */
  fromAddress: string;
  /** Verbatim copy of `shoots.location`. */
  toAddress: string;
  /** YYYY-MM-DD in PORTAL_TIMEZONE, derived from `shoots.scheduled_at`. */
  tripDate: string;
  periodYyyymm: string;
}

// ---------------------------------------------------------------------------
// Minimal suppression-query row shapes. Kept narrow so the orchestrator's
// selects don't pull columns the suggestion logic doesn't need.
// ---------------------------------------------------------------------------

type ExistingIncome = Pick<
  IncomePaymentRecord,
  "client_id" | "payment_date" | "income_type"
>;
type ExistingExpense = Pick<
  ExpenseRecord,
  "source_template_id" | "description" | "date"
>;
type ExistingMileage = Pick<
  MileageLogRecord,
  "source_shoot_id" | "trip_date" | "client_id"
>;
type ShootForSuggestion = Pick<
  ShootRecord,
  "id" | "client_id" | "scheduled_at" | "location" | "status" | "kind"
>;

/**
 * Composite key used to test whether a suggestion has been dismissed.
 * Format: `${type}:${referenceId}`. The orchestrator pre-filters by
 * `period_yyyymm` so the period is implicit in the set.
 */
export type DismissedKey =
  `${DismissedSuggestionRecord["type"]}:${string}`;

// ---------------------------------------------------------------------------
// computeIncomeSuggestions
// ---------------------------------------------------------------------------

export interface ComputeIncomeInput {
  clients: ClientWithRelations[];
  existingIncomePayments: ExistingIncome[];
  monthKey: string;
  dismissed: ReadonlySet<DismissedKey>;
}

/**
 * One suggestion per active brand-retainer client whose monthly payment
 * has not yet been logged for `monthKey`. Eligibility mirrors
 * `app/owner/dashboard/_components/BudgetStatusWidget.tsx:45-51` with an
 * additional `type === 'brand'` clause; the retainer amount comes from
 * the linked package's `monthly_price`.
 */
export function computeIncomeSuggestions({
  clients,
  existingIncomePayments,
  monthKey,
  dismissed,
}: ComputeIncomeInput): IncomeSuggestion[] {
  const eligible = clients.filter((r) => {
    if (r.client.type !== "brand") return false;
    if (r.client.status !== "active" && r.client.status !== "onboarding") {
      return false;
    }
    const price = effectiveMonthlyPrice(r.project, r.pkg);
    return price !== null && price > 0;
  });

  // Pre-bucket: client_id of any brand_retainer payment in this month.
  const satisfiedClientIds = new Set<string>();
  for (const p of existingIncomePayments) {
    if (!p.client_id) continue;
    if (p.income_type !== "brand_retainer") continue;
    if (!p.payment_date.startsWith(monthKey)) continue;
    satisfiedClientIds.add(p.client_id);
  }

  const suggestedDate = `${monthKey}-01`;
  const out: IncomeSuggestion[] = [];
  for (const r of eligible) {
    if (satisfiedClientIds.has(r.client.id)) continue;
    if (dismissed.has(`income_retainer:${r.client.id}`)) continue;
    // Eligibility filter guarantees the effective price is a number > 0.
    const monthlyPrice = effectiveMonthlyPrice(r.project, r.pkg)!;
    out.push({
      type: "income_retainer",
      referenceId: r.client.id,
      clientId: r.client.id,
      clientName: r.client.name,
      incomeType: "brand_retainer",
      amount: monthlyPrice,
      suggestedDate,
      periodYyyymm: monthKey,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// computeExpenseSuggestions
// ---------------------------------------------------------------------------

export interface ComputeExpenseInput {
  templates: RecurringExpenseTemplateRecord[];
  existingExpenses: ExistingExpense[];
  monthKey: string;
  dismissed: ReadonlySet<DismissedKey>;
}

/**
 * One suggestion per active recurring template that has no matching
 * expense in `monthKey`. Suppression prefers FK match
 * (`source_template_id`) and falls back to case-insensitive
 * `description == template.name` for pre-Phase-4 manual entries.
 */
export function computeExpenseSuggestions({
  templates,
  existingExpenses,
  monthKey,
  dismissed,
}: ComputeExpenseInput): ExpenseSuggestion[] {
  const satisfiedByFk = new Set<string>();
  const satisfiedByName = new Set<string>();
  for (const e of existingExpenses) {
    if (!e.date.startsWith(monthKey)) continue;
    if (e.source_template_id) {
      satisfiedByFk.add(e.source_template_id);
    } else if (e.description) {
      satisfiedByName.add(e.description.trim().toLowerCase());
    }
  }

  const out: ExpenseSuggestion[] = [];
  for (const t of templates) {
    if (!t.active) continue;
    if (satisfiedByFk.has(t.id)) continue;
    if (satisfiedByName.has(t.name.trim().toLowerCase())) continue;
    if (dismissed.has(`expense_template:${t.id}`)) continue;

    const day = String(t.day_of_month).padStart(2, "0");
    out.push({
      type: "expense_template",
      referenceId: t.id,
      templateId: t.id,
      name: t.name,
      category: t.category,
      amount: Number(t.amount),
      suggestedDate: `${monthKey}-${day}`,
      periodYyyymm: monthKey,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// computeMileageSuggestions
// ---------------------------------------------------------------------------

export interface ComputeMileageInput {
  shoots: ShootForSuggestion[];
  existingMileageLogs: ExistingMileage[];
  clientNameById: ReadonlyMap<string, string>;
  homeAddress: string;
  monthKey: string;
  dismissed: ReadonlySet<DismissedKey>;
  /** Override for tests; defaults to wall-clock now. */
  now?: Date;
}

/**
 * One suggestion per past, non-cancelled shoot in the month that has no
 * matching mileage log. Skipped entirely when `home_address` is empty —
 * the suggestion needs a from-address. Suppression prefers FK match
 * (`source_shoot_id`) and falls back to same `(trip_date, client_id)`
 * for pre-Phase-4 mileage entries.
 *
 * Meetings (kind='meeting') are excluded; only kind='shoot' generates a
 * mileage suggestion.
 */
export function computeMileageSuggestions({
  shoots,
  existingMileageLogs,
  clientNameById,
  homeAddress,
  monthKey,
  dismissed,
  now = new Date(),
}: ComputeMileageInput): MileageSuggestion[] {
  if (homeAddress.trim() === "") return [];

  const satisfiedByFk = new Set<string>();
  const satisfiedByDateClient = new Set<string>();
  for (const m of existingMileageLogs) {
    if (m.source_shoot_id) {
      satisfiedByFk.add(m.source_shoot_id);
    } else if (m.client_id) {
      satisfiedByDateClient.add(`${m.trip_date}|${m.client_id}`);
    }
  }

  const nowMs = now.getTime();
  const out: MileageSuggestion[] = [];
  for (const s of shoots) {
    if (s.kind !== "shoot") continue;
    if (s.status === "cancelled") continue;
    const startMs = Date.parse(s.scheduled_at);
    if (!Number.isFinite(startMs) || startMs >= nowMs) continue;
    if (!s.location || s.location.trim() === "") continue;

    if (satisfiedByFk.has(s.id)) continue;
    const tripDate = dateKeyInTimezone(new Date(startMs));
    // Pairs with the ±1-day UTC widening in fetchSuggestionInputs: drop shoots
    // whose PORTAL_TIMEZONE date falls outside the displayed month.
    if (!tripDate.startsWith(monthKey)) continue;
    if (satisfiedByDateClient.has(`${tripDate}|${s.client_id}`)) continue;
    if (dismissed.has(`mileage_shoot:${s.id}`)) continue;

    out.push({
      type: "mileage_shoot",
      referenceId: s.id,
      shootId: s.id,
      clientId: s.client_id,
      clientName: clientNameById.get(s.client_id) ?? "",
      fromAddress: homeAddress,
      toAddress: s.location,
      tripDate,
      periodYyyymm: monthKey,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// fetchSuggestionInputs — orchestrates every query the three compute
// functions need, in a single Promise.all.
// ---------------------------------------------------------------------------

export interface SuggestionInputs {
  clients: ClientWithRelations[];
  shoots: ShootForSuggestion[];
  templates: RecurringExpenseTemplateRecord[];
  dismissed: ReadonlySet<DismissedKey>;
  existingIncomePayments: ExistingIncome[];
  existingExpenses: ExistingExpense[];
  existingMileageLogs: ExistingMileage[];
  homeAddress: string;
  clientNameById: ReadonlyMap<string, string>;
}

export async function fetchSuggestionInputs(
  range: { start: string; end: string },
  monthKey: string
): Promise<SuggestionInputs> {
  const supabase = getSupabaseServiceClient();

  // shoots.scheduled_at is UTC. Widen the filter by one day on each side
  // so an early-morning Central shoot on `range.start` and a late-evening
  // Central shoot on `range.end` are both included — same trick used in
  // app/owner/calendar/_lib/queries.ts:59-61.
  const dayMs = 24 * 60 * 60 * 1000;
  const shootStartIso = new Date(
    new Date(`${range.start}T00:00:00Z`).getTime() - dayMs
  ).toISOString();
  const shootEndIso = new Date(
    new Date(`${range.end}T00:00:00Z`).getTime() + 2 * dayMs
  ).toISOString();

  const [
    clientsRel,
    appSettings,
    shootsRes,
    templatesRes,
    dismissedRes,
    incomeRes,
    expenseRes,
    mileageRes,
  ] = await Promise.all([
    fetchClientsWithRelations(),
    fetchAppSettings(),
    supabase
      .from("shoots")
      .select("id, client_id, scheduled_at, location, status, kind")
      .gte("scheduled_at", shootStartIso)
      .lt("scheduled_at", shootEndIso),
    supabase
      .from("recurring_expense_templates")
      .select("*")
      .eq("active", true),
    supabase
      .from("dismissed_suggestions")
      .select("type, reference_id, period_yyyymm")
      .eq("period_yyyymm", monthKey),
    supabase
      .from("income_payments")
      .select("client_id, payment_date, income_type")
      .gte("payment_date", range.start)
      .lte("payment_date", range.end),
    supabase
      .from("expenses")
      .select("source_template_id, description, date")
      .gte("date", range.start)
      .lte("date", range.end),
    supabase
      .from("mileage_logs")
      .select("source_shoot_id, trip_date, client_id")
      .gte("trip_date", range.start)
      .lte("trip_date", range.end),
  ]);

  if (shootsRes.error) throw new Error(shootsRes.error.message);
  if (templatesRes.error) throw new Error(templatesRes.error.message);
  if (dismissedRes.error) throw new Error(dismissedRes.error.message);
  if (incomeRes.error) throw new Error(incomeRes.error.message);
  if (expenseRes.error) throw new Error(expenseRes.error.message);
  if (mileageRes.error) throw new Error(mileageRes.error.message);

  const shoots = (shootsRes.data ?? []) as ShootForSuggestion[];
  const templates = (templatesRes.data ?? []) as RecurringExpenseTemplateRecord[];
  const dismissedRows = (dismissedRes.data ?? []) as Pick<
    DismissedSuggestionRecord,
    "type" | "reference_id" | "period_yyyymm"
  >[];
  const dismissed = new Set<DismissedKey>(
    dismissedRows.map(
      (d) => `${d.type}:${d.reference_id}` as DismissedKey
    )
  );
  const existingIncomePayments = (incomeRes.data ?? []) as ExistingIncome[];
  const existingExpenses = (expenseRes.data ?? []) as ExistingExpense[];
  const existingMileageLogs = (mileageRes.data ?? []) as ExistingMileage[];

  const clientNameById = new Map<string, string>();
  for (const r of clientsRel) {
    clientNameById.set(r.client.id, r.client.name);
  }

  return {
    clients: clientsRel,
    shoots,
    templates,
    dismissed,
    existingIncomePayments,
    existingExpenses,
    existingMileageLogs,
    homeAddress: appSettings.home_address,
    clientNameById,
  };
}
