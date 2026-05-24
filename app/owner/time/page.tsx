import { DashboardCard } from "@/components/ui/DashboardCard";
import { StatCard } from "@/components/ui/StatCard";
import { fetchClientsLite } from "@/app/owner/calendar/_lib/queries";
import { dateKeyInTimezone } from "@/app/owner/calendar/_lib/timezone";
import { QuickLogForm } from "./_components/QuickLogForm";
import { MonthlyHoursChart } from "./_components/MonthlyHoursChart";
import { ExportMonthlyCsvButton } from "./_components/ExportMonthlyCsvButton";
import {
  fetchMonthlyTimeBreakdown,
  fetchWeeklyTimeBreakdown,
} from "./_lib/queries";

export const dynamic = "force-dynamic";

function formatTotalHoursLabel(hours: number): string {
  return hours.toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function OwnerTimePage() {
  const now = new Date();
  const todayKey = dateKeyInTimezone(now);

  const [clients, weekly, monthly] = await Promise.all([
    fetchClientsLite(),
    fetchWeeklyTimeBreakdown(now),
    fetchMonthlyTimeBreakdown(now),
  ]);

  const activeClientsThisWeek = weekly.byClient.filter(
    (c) => c.hours > 0
  ).length;
  const activeClientsThisMonth = monthly.byClient.filter(
    (c) => c.hours > 0
  ).length;

  return (
    <section>
      <header style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: 32,
            fontWeight: 500,
            color: "var(--text-primary)",
            letterSpacing: "-0.01em",
            margin: 0,
          }}
        >
          Time Tracker
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            marginTop: 6,
          }}
        >
          Log hours and track your week.
        </p>
      </header>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        <DashboardCard eyebrow="LOG TIME" title="Add an entry">
          <QuickLogForm clients={clients} todayKey={todayKey} />
        </DashboardCard>

        <DashboardCard eyebrow="THIS WEEK" title={weekly.rangeLabel}>
          {weekly.totalHours === 0 ? (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 14,
                textAlign: "center",
                padding: "32px 0",
                margin: 0,
              }}
            >
              No time logged this week yet.
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 24,
              }}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StatCard
                  label="Total hours this week"
                  value={formatTotalHoursLabel(weekly.totalHours)}
                />
                <StatCard
                  label="Active clients"
                  value={activeClientsThisWeek}
                />
              </div>
              <div className="weekly-breakdown-grid">
                <BreakdownColumn
                  header="By client"
                  rows={weekly.byClient.map((c) => ({
                    key: c.clientId,
                    label: c.clientName,
                    hours: c.hours,
                  }))}
                />
                <BreakdownColumn
                  header="By category"
                  rows={weekly.byCategory.map((c) => ({
                    key: c.category,
                    label: capitalize(c.category),
                    hours: c.hours,
                  }))}
                />
              </div>
            </div>
          )}
        </DashboardCard>

        <DashboardCard eyebrow="THIS MONTH" title={monthly.monthLabel}>
          {monthly.totalHours === 0 ? (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 14,
                textAlign: "center",
                padding: "32px 0",
                margin: 0,
              }}
            >
              No time logged this month yet.
            </p>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 24,
              }}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StatCard
                  label="Total hours this month"
                  value={formatTotalHoursLabel(monthly.totalHours)}
                />
                <StatCard
                  label="Active clients this month"
                  value={activeClientsThisMonth}
                />
              </div>
              <MonthlyHoursChart byClient={monthly.byClient} />
            </div>
          )}
        </DashboardCard>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <ExportMonthlyCsvButton />
        </div>
      </div>

      <style>{`
        .weekly-breakdown-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 24px;
        }
        @media (max-width: 800px) {
          .weekly-breakdown-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}

interface BreakdownRow {
  key: string;
  label: string;
  hours: number;
}

function BreakdownColumn({
  header,
  rows,
}: {
  header: string;
  rows: BreakdownRow[];
}) {
  return (
    <div>
      <p
        style={{
          fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
          fontSize: 12,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {header}
      </p>
      {rows.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
          —
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {rows.map((row, idx) => (
            <li
              key={row.key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 0",
                borderTop:
                  idx === 0 ? "none" : "1px solid var(--border)",
                gap: 12,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-dm-sans), system-ui, sans-serif",
                  fontSize: 14,
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {row.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-playfair), serif",
                  fontSize: 16,
                  color: "var(--text-primary)",
                  flexShrink: 0,
                }}
              >
                {row.hours.toLocaleString(undefined, {
                  minimumFractionDigits: row.hours % 1 === 0 ? 0 : 1,
                  maximumFractionDigits: 1,
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
