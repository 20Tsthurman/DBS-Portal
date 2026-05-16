"use client";

import type { ClientHours } from "../_lib/queries";

interface MonthlyHoursChartProps {
  /** Already sorted by hours desc. Zero-hour rows are filtered here defensively. */
  byClient: ClientHours[];
}

function formatHoursLabel(hours: number): string {
  // 8 → "8 hrs", 8.5 → "8.5 hrs"
  const rounded = Math.round(hours * 10) / 10;
  const str = Number.isInteger(rounded) ? String(rounded) : rounded.toString();
  return `${str} hrs`;
}

/**
 * Horizontal bar chart, one row per client. Bar width is each client's hours
 * as a fraction of the leading client's hours. Pure div + flexbox — there is
 * no chart library in the codebase (`package.json` deps audit, §9 of the
 * pre-build doc).
 */
export function MonthlyHoursChart({ byClient }: MonthlyHoursChartProps) {
  const rows = byClient.filter((c) => c.hours > 0);
  if (rows.length === 0) return null;
  const maxHours = rows[0].hours; // already sorted desc

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {rows.map((row) => {
        const widthPct =
          maxHours > 0 ? Math.max(2, (row.hours / maxHours) * 100) : 0;
        return (
          <div
            key={row.clientId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 180,
                flexShrink: 0,
                fontSize: 14,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={row.clientName}
            >
              {row.clientName}
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 12,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: 12,
                  backgroundColor: "var(--border)",
                  position: "relative",
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    width: `${widthPct}%`,
                    height: "100%",
                    backgroundColor: "var(--accent)",
                  }}
                />
              </div>
              <div
                style={{
                  fontFamily: "var(--font-playfair), serif",
                  fontSize: 14,
                  color: "var(--text-primary)",
                  flexShrink: 0,
                  minWidth: 56,
                  textAlign: "right",
                }}
              >
                {formatHoursLabel(row.hours)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
