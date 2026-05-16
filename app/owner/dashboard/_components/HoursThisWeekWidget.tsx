import Link from "next/link";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { fetchWeeklyTimeBreakdown } from "@/app/owner/time/_lib/queries";

/**
 * Dashboard widget: total hours logged in the current Central-time Monday-start
 * week, with a one-line characterization of where those hours went.
 *
 * Reuses `fetchWeeklyTimeBreakdown()` so the total here is identical to the
 * "This week" total surfaced on /owner/time. Anything > 60% in a single
 * category gets the "Mostly editing" treatment; otherwise we count non-zero
 * categories. Zero-hour weeks short-circuit to a single empty-state line.
 */
export async function HoursThisWeekWidget() {
  const { rangeLabel, totalHours, byCategory } = await fetchWeeklyTimeBreakdown();

  const isEmpty = totalHours === 0;
  const topCategory = byCategory[0] ?? null;
  const dominant =
    !isEmpty && topCategory && topCategory.hours / totalHours > 0.6
      ? topCategory.category
      : null;
  const categoriesWithHours = byCategory.filter((c) => c.hours > 0).length;

  const breakdownLine = dominant
    ? `Mostly ${dominant}`
    : `Across ${categoriesWithHours} categor${categoriesWithHours === 1 ? "y" : "ies"}`;

  return (
    <DashboardCard eyebrow="THIS WEEK" title="Hours Logged">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          paddingTop: 8,
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: 48,
              fontWeight: 500,
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            {formatTotal(totalHours)}
          </span>
          <span
            style={{
              fontSize: 16,
              color: "var(--text-muted)",
            }}
          >
            hrs
          </span>
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          {rangeLabel}
        </div>
        {isEmpty ? (
          <div
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              textAlign: "center",
            }}
          >
            Nothing logged yet this week.
          </div>
        ) : (
          <div
            style={{
              fontSize: 13,
              color: "var(--text-body)",
              textAlign: "center",
            }}
          >
            {breakdownLine}
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: 16,
          textAlign: "right",
        }}
      >
        <Link
          href="/owner/time"
          style={{
            fontSize: 13,
            color: "var(--accent)",
            fontWeight: 600,
          }}
        >
          View time tracker →
        </Link>
      </div>
    </DashboardCard>
  );
}

/**
 * Whole-number totals lose the trailing ".0" so "12" reads cleaner than
 * "12.0" at 48px; fractional totals keep one decimal.
 */
function formatTotal(hours: number): string {
  if (Number.isInteger(hours)) return String(hours);
  return hours.toFixed(1);
}
