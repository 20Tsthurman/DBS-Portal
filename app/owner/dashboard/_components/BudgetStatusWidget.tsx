import Link from "next/link";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { fetchClientsWithRelations } from "@/app/owner/clients/_lib/queries";
import {
  dateKeyInTimezone,
  PORTAL_TIMEZONE,
} from "@/app/owner/calendar/_lib/timezone";
import { effectiveMonthlyHours } from "@/lib/pricing";

const MAX_VISIBLE = 8;

type Tone = "green" | "amber" | "red";

interface BudgetRow {
  clientId: string;
  clientName: string;
  packageLabel: string;
  hoursThisMonth: number;
  monthlyHours: number;
  budgetConsumed: number;
  tone: Tone;
}

/**
 * Dashboard widget: month-to-date budget pacing for every retainer client
 * (status active or onboarding) that has a package with monthly_hours > 0.
 *
 * Three-color pacing model (see `computeTone`):
 *   red    — over budget
 *   amber  — 80%+ consumed, OR past mid-month and trailing pace by 15+ points
 *   green  — on track
 *
 * Sort surfaces trouble first: red → amber → green; within a tone, greens
 * are sorted by % consumed desc (closest-to-trouble first) and ties break
 * alphabetically by client name. Long lists cap at 8 with a footer link
 * out to /owner/clients.
 *
 * Timezone note: dayOfMonth must come from `dateKeyInTimezone(new Date())`,
 * NOT `new Date().getDate()` — the latter reads server-local time and will
 * drift on a UTC host around midnight Central. Same goes for daysInMonth,
 * which we derive from the same Central year+month.
 */
export async function BudgetStatusWidget() {
  const all = await fetchClientsWithRelations();

  const eligible = all.filter((r) => {
    if (r.client.status !== "active" && r.client.status !== "onboarding") {
      return false;
    }
    const hours = effectiveMonthlyHours(r.project, r.pkg);
    return hours !== null && hours > 0;
  });

  const { dayOfMonth, daysInMonth } = currentDayAndLengthInPortalTz();
  const monthProgress = dayOfMonth / daysInMonth;

  const rows: BudgetRow[] = eligible.map((r) => {
    // Filter above guarantees an effective hours value > 0.
    const monthlyHours = effectiveMonthlyHours(r.project, r.pkg)!;
    const hoursThisMonth = r.hoursThisMonth;
    const budgetConsumed = hoursThisMonth / monthlyHours;
    const tone = computeTone(budgetConsumed, monthProgress);
    const labelPrefix = r.pkg?.name ?? "Custom rate";
    return {
      clientId: r.client.id,
      clientName: r.client.name,
      packageLabel: `${labelPrefix} · ${formatBudgetHours(monthlyHours)} hrs/mo`,
      hoursThisMonth,
      monthlyHours,
      budgetConsumed,
      tone,
    };
  });

  rows.sort(compareRows);

  const totalCount = rows.length;
  const visible = rows.slice(0, MAX_VISIBLE);
  const showFooter = totalCount > MAX_VISIBLE;

  return (
    <DashboardCard eyebrow="MONTH TO DATE" title="Budget Status">
      {totalCount === 0 ? (
        <div
          style={{
            paddingTop: 8,
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          No active retainer clients with packages.
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {visible.map((row, idx) => (
            <li
              key={row.clientId}
              style={{
                borderTop: idx === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <Link
                href={`/owner/clients/${row.clientId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "12px 0",
                  color: "inherit",
                }}
              >
                <div
                  style={{
                    flex: "0 0 38%",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.clientName}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.packageLabel}
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 16,
                    backgroundColor: "var(--border)",
                    position: "relative",
                    overflow: "hidden",
                  }}
                  aria-label={`${Math.round(row.budgetConsumed * 100)}% of budget used`}
                >
                  <div
                    style={{
                      width: `${Math.min(row.budgetConsumed, 1) * 100}%`,
                      height: "100%",
                      backgroundColor: toneToColor(row.tone),
                    }}
                  />
                </div>
                <div
                  style={{
                    flex: "0 0 auto",
                    fontSize: 13,
                    fontWeight: 600,
                    color: toneToColor(row.tone),
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatHoursOneDecimal(row.hoursThisMonth)} /{" "}
                  {formatBudgetHours(row.monthlyHours)} hrs
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {showFooter && (
        <div
          style={{
            marginTop: 16,
            textAlign: "right",
          }}
        >
          <Link
            href="/owner/clients"
            style={{
              fontSize: 13,
              color: "var(--accent)",
              fontWeight: 600,
            }}
          >
            View all {totalCount} clients →
          </Link>
        </div>
      )}
    </DashboardCard>
  );
}

function computeTone(budgetConsumed: number, monthProgress: number): Tone {
  if (budgetConsumed > 1.0) return "red";
  if (budgetConsumed > 0.8) return "amber";
  if (monthProgress > 0.5 && budgetConsumed < monthProgress - 0.15) {
    return "amber";
  }
  return "green";
}

function toneRank(tone: Tone): number {
  if (tone === "red") return 0;
  if (tone === "amber") return 1;
  return 2;
}

function toneToColor(tone: Tone): string {
  if (tone === "red") return "var(--status-danger)";
  if (tone === "amber") return "var(--status-warning)";
  return "var(--status-success)";
}

function compareRows(a: BudgetRow, b: BudgetRow): number {
  const r = toneRank(a.tone) - toneRank(b.tone);
  if (r !== 0) return r;
  // Within a tone, surface closest-to-trouble first (higher consumed first).
  // This matters most for greens — the spec calls it out explicitly there,
  // and it's a sensible default for amber/red too.
  const c = b.budgetConsumed - a.budgetConsumed;
  if (c !== 0) return c;
  return a.clientName.localeCompare(b.clientName);
}

/**
 * Today's day-of-month and the month's total day count, both interpreted in
 * PORTAL_TIMEZONE. Uses the `Date.UTC(y, m, 0).getUTCDate()` trick (same
 * pattern as `currentMonthRange`) for the last-day-of-month integer.
 */
function currentDayAndLengthInPortalTz(): {
  dayOfMonth: number;
  daysInMonth: number;
} {
  const key = dateKeyInTimezone(new Date(), PORTAL_TIMEZONE);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const dayOfMonth = Number(key.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { dayOfMonth, daysInMonth };
}

function formatHoursOneDecimal(hours: number): string {
  return hours.toFixed(1);
}

/**
 * Budget hours from the `packages` row are typically whole numbers (16, 24,
 * 40). Show them without a decimal in that case; preserve precision if a
 * fractional package ever sneaks in.
 */
function formatBudgetHours(hours: number): string {
  if (Number.isInteger(hours)) return String(hours);
  return hours.toFixed(1);
}
