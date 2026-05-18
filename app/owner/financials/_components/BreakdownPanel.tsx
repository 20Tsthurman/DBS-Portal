import type { CSSProperties } from "react";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { formatCurrency } from "@/app/owner/clients/_lib/format";

interface BreakdownPanelProps {
  summary: {
    income: number;
    expenses: number;
    mileageDeduction: number;
    netProfit: number;
    taxSetAside: number;
    takeHome: number;
    taxRatePercent: number;
  };
}

const rowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  paddingBlock: 8,
};

const labelStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--text-muted)",
  fontWeight: 400,
};

const amountStyle: CSSProperties = {
  fontSize: 14,
  color: "var(--text-primary)",
  fontWeight: 400,
  fontFeatureSettings: '"tnum"',
};

const dividerStyle: CSSProperties = {
  borderTop: "1px solid var(--border)",
  marginBlock: 8,
};

function formatAmount(value: number, negative: boolean): string {
  return negative ? `−${formatCurrency(value)}` : formatCurrency(value);
}

interface RowProps {
  label: string;
  amount: number;
  negative?: boolean;
  amountWeight?: number;
}

function Row({ label, amount, negative = false, amountWeight = 400 }: RowProps) {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...amountStyle, fontWeight: amountWeight }}>
        {formatAmount(amount, negative)}
      </span>
    </div>
  );
}

export function BreakdownPanel({ summary }: BreakdownPanelProps) {
  const cashExpenses = summary.expenses - summary.mileageDeduction;

  const isEmpty =
    summary.income === 0 &&
    cashExpenses === 0 &&
    summary.mileageDeduction === 0;

  if (isEmpty) {
    return (
      <DashboardCard eyebrow="BREAKDOWN" title="This month's math">
        <p
          style={{
            fontSize: 14,
            color: "var(--text-muted)",
            paddingBlock: 8,
            margin: 0,
          }}
        >
          No financial activity this month yet.
        </p>
      </DashboardCard>
    );
  }

  const takeHomeColor =
    summary.takeHome > 0 ? "var(--status-success)" : "var(--text-primary)";
  const takeHomeStyle: CSSProperties = {
    fontFamily: "var(--font-playfair), serif",
    fontSize: 20,
    fontWeight: 500,
    color: takeHomeColor,
    letterSpacing: "-0.01em",
  };

  return (
    <DashboardCard eyebrow="BREAKDOWN" title="This month's math">
      <Row label="Income" amount={summary.income} />
      <Row label="Cash expenses" amount={cashExpenses} negative />
      <Row
        label="Mileage write-off*"
        amount={summary.mileageDeduction}
        negative
      />
      <div style={dividerStyle} />
      <Row
        label="Taxable profit"
        amount={summary.netProfit}
        amountWeight={600}
      />
      <Row
        label={`Tax set-aside (${summary.taxRatePercent}%)`}
        amount={summary.taxSetAside}
        negative
      />
      <div style={dividerStyle} />
      <div style={rowStyle}>
        <span style={takeHomeStyle}>Take-home</span>
        <span style={{ ...takeHomeStyle, fontFeatureSettings: '"tnum"' }}>
          {formatCurrency(summary.takeHome)}
        </span>
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          fontStyle: "italic",
          margin: 0,
          marginTop: 12,
        }}
      >
        * Tax deduction — doesn&apos;t leave your bank account
      </p>
    </DashboardCard>
  );
}
