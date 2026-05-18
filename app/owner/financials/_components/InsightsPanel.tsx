import type { ReactNode } from "react";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { formatPercent } from "@/app/owner/clients/_lib/format";
import { IconActivity, IconBell, IconTrendingUp } from "./StatCardIcons";

type InsightTone = "default" | "success" | "muted";

const TONE_COLOR: Record<InsightTone, string> = {
  default: "var(--text-primary)",
  success: "var(--status-success)",
  muted: "var(--accent)",
};

const TONE_TILE_BG: Record<InsightTone, string> = {
  default: "color-mix(in srgb, var(--text-primary) 8%, transparent)",
  success: "color-mix(in srgb, var(--status-success) 12%, transparent)",
  muted: "color-mix(in srgb, var(--accent) 10%, transparent)",
};

interface InsightsPanelProps {
  summary: {
    income: number;
    takeHome: number;
  };
  pendingSuggestionsCount: number;
  incomeCount: number;
  expenseCount: number;
}

interface Row {
  key: string;
  tone: InsightTone;
  icon: ReactNode;
  value: string;
  descriptor: string;
}

function plural(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : pluralForm ?? `${singular}s`;
}

export function InsightsPanel({
  summary,
  pendingSuggestionsCount,
  incomeCount,
  expenseCount,
}: InsightsPanelProps) {
  const hasIncome = summary.income > 0;
  const hasPending = pendingSuggestionsCount > 0;

  const rows: Row[] = [
    {
      key: "take-home-pace",
      tone: "success",
      icon: <IconTrendingUp size={28} />,
      value: hasIncome
        ? formatPercent(summary.takeHome / summary.income)
        : "—",
      descriptor: hasIncome
        ? "of income is take-home this month"
        : "No income logged yet this month",
    },
    {
      key: "pending-review",
      tone: hasPending ? "muted" : "success",
      icon: <IconBell size={28} />,
      value: hasPending ? String(pendingSuggestionsCount) : "✓",
      descriptor: hasPending
        ? `${plural(pendingSuggestionsCount, "suggestion")} waiting for review`
        : "All caught up — no suggestions pending",
    },
    {
      key: "activity-this-month",
      tone: "default",
      icon: <IconActivity size={28} />,
      value: String(incomeCount + expenseCount),
      descriptor: `${incomeCount} ${plural(
        incomeCount,
        "payment"
      )} · ${expenseCount} ${plural(expenseCount, "expense")} logged`,
    },
  ];

  return (
    <DashboardCard eyebrow="INSIGHTS" title="At a glance">
      {rows.map((row, idx) => (
        <div
          key={row.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            paddingBlock: 16,
            borderBottom:
              idx < rows.length - 1 ? "1px solid var(--border)" : "none",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 56,
              height: 56,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: TONE_TILE_BG[row.tone],
              color: TONE_COLOR[row.tone],
              flexShrink: 0,
            }}
          >
            {row.icon}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p
              style={{
                fontFamily: "var(--font-playfair), serif",
                fontSize: 24,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                lineHeight: 1.1,
                color: TONE_COLOR[row.tone],
                margin: 0,
              }}
            >
              {row.value}
            </p>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                lineHeight: 1.5,
                margin: 0,
                marginTop: 4,
              }}
            >
              {row.descriptor}
            </p>
          </div>
        </div>
      ))}
    </DashboardCard>
  );
}
