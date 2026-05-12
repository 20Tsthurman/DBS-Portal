"use client";

import { useState } from "react";
import type { AvailabilityBlockRecord } from "@/lib/supabase";
import { AvailabilityBlockFormPanel } from "@/app/owner/calendar/_components/AvailabilityBlockFormPanel";
import { BlockRowActions } from "@/app/owner/calendar/_components/BlockRowActions";
import {
  formatTimeRange,
  weekdayLabel,
} from "@/app/owner/calendar/_lib/dateMath";

interface RecurringColumnProps {
  weekday: number;
  blocks: AvailabilityBlockRecord[];
  isLast: boolean;
}

export function RecurringColumn({
  weekday,
  blocks,
  isLast,
}: RecurringColumnProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div
      style={{
        padding: "14px 12px 16px",
        borderRight: isLast ? undefined : "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        minHeight: 280,
      }}
    >
      <h3
        style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-primary)",
          fontWeight: 600,
          marginBottom: 14,
        }}
      >
        {weekdayLabel(weekday)}
      </h3>

      <ul
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          flex: 1,
          listStyle: "none",
          padding: 0,
          margin: 0,
        }}
      >
        {blocks.map((b) => (
          <li
            key={b.id}
            style={{
              border: "1px solid var(--border)",
              padding: "8px 10px",
              backgroundColor: "var(--surface-base)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 6,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--text-primary)",
                  fontWeight: 600,
                }}
              >
                <span>{formatTimeRange(b.start_time, b.end_time)}</span>
                {!b.is_blocked && (
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--status-success)",
                      fontWeight: 600,
                    }}
                  >
                    Available
                  </span>
                )}
              </div>
              {b.label && (
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {b.label}
                </div>
              )}
            </div>
            <BlockRowActions block={b} canEdit />
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        style={{
          marginTop: 14,
          padding: "8px 10px",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          backgroundColor: "transparent",
          border: "1px solid var(--border)",
          color: "var(--text-body)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        + Add Block
      </button>

      <AvailabilityBlockFormPanel
        open={addOpen}
        onClose={() => setAddOpen(false)}
        recurringWeekday={weekday}
      />
    </div>
  );
}
