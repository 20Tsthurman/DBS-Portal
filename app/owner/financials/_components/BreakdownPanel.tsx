import type { CSSProperties } from "react";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { formatCurrency } from "@/app/owner/clients/_lib/format";

interface BreakdownPanelProps {
  summary: {
    income: number;
    cashExpenses: number;
    deductibleExpenses: number;
    mileageDeduction: number;
    taxableProfit: number;
    taxSetAside: number;
    netCashRetained: number;
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

// Matches the StatCard eyebrow treatment so the two blocks read as
// section headers, not data rows.
const sectionLabelStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 4,
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

/**
 * Two blocks, each reconciling on its own:
 *   Tax:  income − deductible expenses − mileage = taxable profit
 *   Cash: income − cash expenses − tax set-aside = net cash retained
 * The set-aside (rate% of taxable profit) is the bridge — computed by the
 * tax block, subtracted in the cash block. Chaining both into one column
 * was the original take-home bug in visual form.
 */
export function BreakdownPanel({ summary }: BreakdownPanelProps) {
  const isEmpty =
    summary.income === 0 &&
    summary.cashExpenses === 0 &&
    summary.deductibleExpenses === 0 &&
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

  const retainedColor =
    summary.netCashRetained > 0
      ? "var(--status-success)"
      : "var(--text-primary)";
  const retainedStyle: CSSProperties = {
    fontFamily: "var(--font-playfair), serif",
    fontSize: 20,
    fontWeight: 500,
    color: retainedColor,
    letterSpacing: "-0.01em",
  };

  return (
    <DashboardCard eyebrow="BREAKDOWN" title="This month's math">
      <p style={sectionLabelStyle}>Schedule C (tax)</p>
      <Row label="Income" amount={summary.income} />
      <Row
        label="Deductible expenses"
        amount={summary.deductibleExpenses}
        negative
      />
      <Row
        label="Mileage write-off*"
        amount={summary.mileageDeduction}
        negative
      />
      <div style={dividerStyle} />
      <Row
        label="Taxable profit"
        amount={summary.taxableProfit}
        amountWeight={600}
      />

      <p style={{ ...sectionLabelStyle, marginTop: 20 }}>Cash</p>
      <Row label="Income" amount={summary.income} />
      <Row label="Cash expenses" amount={summary.cashExpenses} negative />
      <Row
        label={`Tax set-aside (${summary.taxRatePercent}%)`}
        amount={summary.taxSetAside}
        negative
      />
      <div style={dividerStyle} />
      <div style={rowStyle}>
        <span style={retainedStyle}>Net cash retained</span>
        <span style={{ ...retainedStyle, fontFeatureSettings: '"tnum"' }}>
          {formatCurrency(summary.netCashRetained)}
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
