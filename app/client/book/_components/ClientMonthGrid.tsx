import Link from "next/link";
import type {
  AvailabilityBlockRecord,
  ShootRecord,
  ShootStatus,
} from "@/lib/supabase";
// TODO: promote to shared (e.g. lib/calendar/) once a 3rd consumer exists.
import {
  dateKey,
  formatMonthParam,
  formatTimeOnly,
  getMonthGrid,
  inMonth,
  isToday,
  type YearMonth,
} from "@/app/owner/calendar/_lib/dateMath";
// TODO: promote to shared (e.g. lib/availability.ts) once a 3rd consumer exists.
import { classifyBlocksForDate } from "@/app/owner/calendar/_lib/queries";

interface ClientMonthGridProps {
  ym: YearMonth;
  myShoots: ShootRecord[];
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

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function ClientMonthGrid({
  ym,
  myShoots,
  blocks,
  selectedDateKey,
}: ClientMonthGridProps) {
  const days = getMonthGrid(ym);
  const today = startOfToday();

  const byDay = new Map<string, ShootRecord[]>();
  for (const s of myShoots) {
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
              borderRight: i < 6 ? "1px solid var(--border)" : undefined,
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
          const isCurrentDay = isToday(day);
          const isPast = day < today;
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

          let cellBg = "transparent";
          if (selected) {
            cellBg = "rgba(168, 120, 138, 0.16)";
          } else if (hasAllDayBlocked) {
            cellBg = "rgba(168, 120, 138, 0.06)";
          } else if (hasAllDayAvailable) {
            cellBg = "rgba(45, 106, 79, 0.06)";
          }

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
                ? "Kelsey has availability windows"
                : "Kelsey has limited availability";

          const dateNumberColor = isPast
            ? "var(--text-muted)"
            : inThisMonth
              ? "var(--text-primary)"
              : "var(--text-muted)";

          const cellStyle = {
            position: "relative" as const,
            display: "block",
            minHeight: 120,
            padding: "6px 8px",
            borderRight: col < 6 ? "1px solid var(--border)" : undefined,
            borderBottom: row < 5 ? "1px solid var(--border)" : undefined,
            backgroundColor: cellBg,
            color: "inherit",
            outline: isCurrentDay ? "2px solid var(--accent)" : undefined,
            outlineOffset: isCurrentDay ? ("-2px" as const) : undefined,
            cursor: isPast ? ("default" as const) : undefined,
          };

          const cellInner = (
            <>
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
                  fontWeight: isCurrentDay ? 700 : 600,
                  color: dateNumberColor,
                  marginBottom: 4,
                }}
              >
                {day.getDate()}
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
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
                      title={`${formatTimeOnly(when)} — Your shoot${s.location ? ` · ${s.location}` : ""}`}
                    >
                      <span style={{ fontWeight: 600, marginRight: 4 }}>
                        {formatTimeOnly(when)}
                      </span>
                      <span>Your shoot</span>
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
            </>
          );

          if (isPast) {
            return (
              <div
                key={key + "-" + idx}
                title={cellTitle}
                aria-disabled="true"
                style={cellStyle}
              >
                {cellInner}
              </div>
            );
          }

          return (
            <Link
              key={key + "-" + idx}
              href={`/client/book?month=${monthParam}&date=${key}`}
              title={cellTitle}
              style={cellStyle}
            >
              {cellInner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
