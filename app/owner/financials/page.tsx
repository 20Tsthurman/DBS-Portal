/**
 * /owner/financials — monthly working surface.
 *
 * URL contract:
 *   /owner/financials                              → range=month, month=current
 *   /owner/financials?month=YYYY-MM                → that month
 *   /owner/financials?range=ytd                    → YTD: Jan-1-thisyear to today
 *   /owner/financials?range=month&month=YYYY-MM    → equivalent to ?month=…
 *
 * Rules:
 *   - `range` defaults to "month" when missing or invalid.
 *   - `month` defaults to currentMonthKey() when missing or invalid.
 *   - When range === "ytd", the `month` param is ignored (the toolbar shows
 *     the year label and dims its month arrows / Today).
 *   - Year picker for YTD is out of scope — current PORTAL_TIMEZONE year only.
 *
 * Page auth: relies on the owner-only guard in app/owner/layout.tsx; no
 * per-page requireOwner() call (matches every other owner page).
 *
 * Tables are inline-editable: page stays a server component, hands the fetched
 * rows to <FinancialsBoard /> (a client component) which owns row state,
 * cell-level edits, and live Summary recompute. See _components/ for details.
 */

import {
  currentMonthKey,
  formatMonthLabel,
  monthRangeForKey,
  yearToDateRange,
} from "@/app/owner/calendar/_lib/timezone";
import { fetchClientsWithRelations } from "@/app/owner/clients/_lib/queries";
import { FinancialsBoard } from "./_components/FinancialsBoard";
import { FinancialsToolbar } from "./_components/FinancialsToolbar";
import {
  fetchAppSettings,
  fetchFinancialsForRange,
  type FinancialsRange,
} from "./_lib/queries";
import {
  computeExpenseSuggestions,
  computeIncomeSuggestions,
  computeMileageSuggestions,
  fetchSuggestionInputs,
  type ExpenseSuggestion,
  type IncomeSuggestion,
  type MileageSuggestion,
} from "./_lib/suggestions";

export const dynamic = "force-dynamic";

type RawSearchParams = Promise<{
  month?: string | string[];
  range?: string | string[];
}>;

function paramStr(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isValidMonthKey(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return false;
  const month = Number(s.slice(5, 7));
  return month >= 1 && month <= 12;
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: RawSearchParams;
}) {
  const params = await searchParams;
  const rangeParam = paramStr(params.range);
  const range: "month" | "ytd" = rangeParam === "ytd" ? "ytd" : "month";

  const monthParam = paramStr(params.month);
  const monthKey = isValidMonthKey(monthParam) ? monthParam : currentMonthKey();

  let fetchRange: FinancialsRange;
  let yearLabel: string;
  if (range === "ytd") {
    const ytd = yearToDateRange();
    yearLabel = ytd.year;
    fetchRange = {
      start: ytd.start,
      end: ytd.end,
      label: `${ytd.year} Year-to-Date`,
    };
  } else {
    const r = monthRangeForKey(monthKey);
    yearLabel = monthKey.slice(0, 4);
    fetchRange = {
      start: r.start,
      end: r.end,
      label: formatMonthLabel(monthKey),
    };
  }

  // Suggestions are month-scoped; suppress entirely in YTD view.
  // Otherwise fetch the display rows and suggestion inputs in parallel.
  // Also fetch the clients roster + app_settings for the mobile sheet
  // (client datalist + readonly IRS rate). Both queries are React-cache
  // memoized inside fetchSuggestionInputs / fetchFinancialsForRange, so
  // the extra calls here only do work on the YTD path.
  const [data, suggestionInputs, clientsRel, appSettings] = await Promise.all([
    fetchFinancialsForRange(fetchRange),
    range === "month"
      ? fetchSuggestionInputs(
          { start: fetchRange.start, end: fetchRange.end },
          monthKey
        )
      : Promise.resolve(null),
    fetchClientsWithRelations(),
    fetchAppSettings(),
  ]);

  const clientNames = clientsRel
    .filter(
      (r) => r.client.status === "active" || r.client.status === "onboarding"
    )
    .map((r) => r.client.name)
    .sort((a, b) => a.localeCompare(b));
  const mileageRatePerMile = Number(appSettings.mileage_rate_per_mile);

  let incomeSuggestions: IncomeSuggestion[] = [];
  let expenseSuggestions: ExpenseSuggestion[] = [];
  let mileageSuggestions: MileageSuggestion[] = [];
  if (suggestionInputs) {
    incomeSuggestions = computeIncomeSuggestions({
      clients: suggestionInputs.clients,
      existingIncomePayments: suggestionInputs.existingIncomePayments,
      monthKey,
      dismissed: suggestionInputs.dismissed,
    });
    expenseSuggestions = computeExpenseSuggestions({
      templates: suggestionInputs.templates,
      existingExpenses: suggestionInputs.existingExpenses,
      monthKey,
      dismissed: suggestionInputs.dismissed,
    });
    mileageSuggestions = computeMileageSuggestions({
      shoots: suggestionInputs.shoots,
      existingMileageLogs: suggestionInputs.existingMileageLogs,
      clientNameById: suggestionInputs.clientNameById,
      homeAddress: suggestionInputs.homeAddress,
      monthKey,
      dismissed: suggestionInputs.dismissed,
    });
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <h1
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontWeight: 500,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
            margin: 0,
          }}
          className="text-[26px] lg:text-[32px]"
        >
          Financials
        </h1>

        <FinancialsToolbar
          range={range}
          monthKey={monthKey}
          yearLabel={yearLabel}
        />
      </div>

      <FinancialsBoard
        key={range === "ytd" ? `ytd-${yearLabel}` : `month-${monthKey}`}
        initialIncomeRows={data.incomeRows}
        initialExpenseRows={data.expenseRows}
        initialMileageRows={data.mileageRows}
        taxRatePercent={data.summary.taxRatePercent}
        incomeSuggestions={incomeSuggestions}
        expenseSuggestions={expenseSuggestions}
        mileageSuggestions={mileageSuggestions}
        clientNames={clientNames}
        mileageRatePerMile={mileageRatePerMile}
      />
    </div>
  );
}
