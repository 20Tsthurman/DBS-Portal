import Link from "next/link";
import type { ShootRecord } from "@/lib/supabase";
import {
  formatTimeInTimezone,
  fullDateLabelForDateKey,
  dateKeyInTimezone,
} from "@/app/owner/calendar/_lib/timezone";
import { StatusBadge } from "./StatusBadge";

interface MyShootsListProps {
  /** Already filtered to upcoming (requested + confirmed). */
  shoots: ShootRecord[];
  /** URL prefix to append `&shoot=<id>` to. */
  baseHref: string;
}

export function MyShootsList({ shoots, baseHref }: MyShootsListProps) {
  const sorted = [...shoots].sort(
    (a, b) =>
      new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
  );

  return (
    <section style={{ marginTop: 32 }}>
      <h3
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: 20,
          fontWeight: 500,
          color: "var(--text-primary)",
          letterSpacing: "-0.01em",
          marginBottom: 16,
        }}
      >
        Upcoming shoots
      </h3>

      {sorted.length === 0 ? (
        <p
          style={{
            color: "var(--text-muted)",
            fontStyle: "italic",
            fontSize: 14,
          }}
        >
          No upcoming shoots.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            border: "1px solid var(--border)",
            backgroundColor: "var(--surface-raised)",
          }}
        >
          {sorted.map((s, i) => (
            <ShootRow
              key={s.id}
              shoot={s}
              baseHref={baseHref}
              isLast={i === sorted.length - 1}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ShootRowProps {
  shoot: ShootRecord;
  baseHref: string;
  isLast: boolean;
}

function ShootRow({ shoot, baseHref, isLast }: ShootRowProps) {
  const startsAt = new Date(shoot.scheduled_at);
  const endsAt = new Date(
    startsAt.getTime() + (shoot.duration_hours ?? 1) * 3600 * 1000
  );
  const dk = dateKeyInTimezone(startsAt);
  const dateLabel = fullDateLabelForDateKey(dk);
  const timeRange = `${formatTimeInTimezone(startsAt)} – ${formatTimeInTimezone(
    endsAt
  )}`;
  const location = shoot.location?.trim() || null;

  return (
    <li
      style={{
        borderBottom: isLast ? undefined : "1px solid var(--border)",
      }}
    >
      <Link
        href={`${baseHref}&shoot=${shoot.id}`}
        className="agenda-row"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "14px 16px",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {dateLabel}
            <span style={{ color: "var(--text-body)", fontWeight: 400 }}>
              {" · "}
              {timeRange}
            </span>
          </div>
          {location && (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {location}
            </div>
          )}
        </div>
        <StatusBadge status={shoot.status} />
      </Link>
    </li>
  );
}
