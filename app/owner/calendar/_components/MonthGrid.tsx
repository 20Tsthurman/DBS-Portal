import Link from "next/link";
import type {
  AvailabilityBlockRecord,
  ShootStatus,
} from "@/lib/supabase";
import type { ShootWithClientName } from "@/app/owner/shoots/_lib/queries";
import {
  dateKey,
  formatMonthParam,
  formatTimeOnly,
  getMonthGrid,
  inMonth,
  isToday,
  type YearMonth,
} from "../_lib/dateMath";
import { classifyBlocksForDate } from "../_lib/queries";

interface MonthGridProps {
  ym: YearMonth;
  shoots: ShootWithClientName[];
  blocks: AvailabilityBlockRecord[];
  selectedDateKey: string | null;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface PillVisuals {
  backgroundColor: string;
  color: string;
  borderLeft?: string;
  textDecoration?: string;
}

function pillStyle(status: ShootStatus): PillVisuals {
  switch (status) {
    case "confirmed":
      return {
        backgroundColor: "var(--accent)",
        color: "#FFFFFF",
      };
    case "requested":
      return {
        backgroundColor: "var(--surface-raised)",
        color: "var(--text-primary)",
        borderLeft: "3px solid var(--text-muted)",
      };
    case "completed":
      return {
        backgroundColor: "rgba(45, 106, 79, 0.4)",
        color: "var(--text-body)",
        textDecoration: "line-through",
      };
    case "cancelled":
      return {
        backgroundColor: "rgba(122, 48, 64, 0.3)",
        color: "var(--text-body)",
        textDecoration: "line-through",
      };
  }
}

export function MonthGrid({
  ym,
  shoots,
  blocks,
  selectedDateKey,
}: MonthGridProps) {
  const days = getMonthGrid(ym);

  const byDay = new Map<string, ShootWithClientName[]>();
  for (const s of shoots) {
    const k = dateKey(new Date(s.scheduled_at));
    const list = byDay.get(k);
    if (list) list.push(s);
    else byDay.set(k, [s]);
  }

  const monthParam = formatMonthParam(ym);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        backgroundColor: "var(--surface-raised)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={label}
            style={{
              padding: "10px 12px",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-body)",
              fontWeight: 600,
              borderRight:
                i < 6 ? "1px solid var(--border)" : undefined,
              backgroundColor: "var(--surface-base)",
            }}
          >
            {label}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "minmax(120px, auto)",
        }}
      >
        {days.map((day, idx) => {
          const key = dateKey(day);
          const inThisMonth = inMonth(day, ym);
          const today = isToday(day);
          const selected = selectedDateKey === key;
          const { mode, blockedBlocks, availableBlocks } =
            classifyBlocksForDate(blocks, day);
          const hasAllDayBlocked = blockedBlocks.some(
            (b) => b.start_time === null
          );
          const hasTimeRangeBlocked = blockedBlocks.some(
            (b) => b.start_time !== null
          );
          const hasAllDayAvailable = availableBlocks.some(
            (b) => b.start_time === null
          );
          const hasTimeRangeAvailable = availableBlocks.some(
            (b) => b.start_time !== null
          );
          const dayShoots = byDay.get(key) ?? [];
          const visible = dayShoots.slice(0, 3);
          const overflow = dayShoots.length - visible.length;

          const col = idx % 7;
          const row = Math.floor(idx / 7);

          // Cell background: selection > all-day blocked > all-day available > transparent.
          let cellBg = "transparent";
          if (selected) {
            cellBg = "rgba(168, 120, 138, 0.16)";
          } else if (hasAllDayBlocked) {
            cellBg = "rgba(168, 120, 138, 0.06)";
          } else if (hasAllDayAvailable) {
            cellBg = "rgba(45, 106, 79, 0.06)";
          }

          // Top bar: blocked time-range wins; otherwise green for available-only days.
          let topBarColor: string | null = null;
          if (hasTimeRangeBlocked && !hasAllDayBlocked) {
            topBarColor = "var(--accent)";
          } else if (
            mode === "available" &&
            hasTimeRangeAvailable &&
            !hasAllDayAvailable &&
            !hasAllDayBlocked
          ) {
            topBarColor = "var(--status-success)";
          }

          const totalApplicable =
            blockedBlocks.length + availableBlocks.length;
          const cellTitle =
            totalApplicable === 0
              ? undefined
              : mode === "available"
                ? "Kelsey has availability windows on this day"
                : "Kelsey has limited availability";

          return (
            <Link
              key={key + "-" + idx}
              href={`/owner/calendar?month=${monthParam}&date=${key}`}
              title={cellTitle}
              style={{
                position: "relative",
                display: "block",
                minHeight: 120,
                padding: "6px 8px",
                borderRight:
                  col < 6 ? "1px solid var(--border)" : undefined,
                borderBottom:
                  row < 5 ? "1px solid var(--border)" : undefined,
                backgroundColor: cellBg,
                color: "inherit",
                outline: today
                  ? "2px solid var(--accent)"
                  : undefined,
                outlineOffset: today ? "-2px" : undefined,
              }}
            >
              {topBarColor && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    backgroundColor: topBarColor,
                    opacity: 0.5,
                  }}
                />
              )}
              <div
                style={{
                  fontSize: 13,
                  fontWeight: today ? 700 : 600,
                  color: inThisMonth
                    ? "var(--text-primary)"
                    : "var(--text-muted)",
                  marginBottom: 4,
                }}
              >
                {day.getDate()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {visible.map((s) => {
                  const when = new Date(s.scheduled_at);
                  return (
                    <div
                      key={s.id}
                      style={{
                        padding: "1px 6px",
                        fontSize: 11,
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        ...pillStyle(s.status),
                      }}
                      title={`${formatTimeOnly(when)} — ${s.client_name}${s.location ? ` · ${s.location}` : ""}`}
                    >
                      <span style={{ fontWeight: 600, marginRight: 4 }}>
                        {formatTimeOnly(when)}
                      </span>
                      <span>{s.client_name || "—"}</span>
                      {s.status === "requested" && (
                        <span
                          style={{
                            fontStyle: "italic",
                            color: "var(--text-muted)",
                          }}
                        >
                          {" "}
                          (Pending)
                        </span>
                      )}
                    </div>
                  );
                })}
                {overflow > 0 && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      fontWeight: 600,
                      marginTop: 2,
                    }}
                  >
                    +{overflow} more
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
