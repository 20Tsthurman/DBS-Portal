import Link from "next/link";
import type { AvailabilityBlockRecord } from "@/lib/supabase";
import { fetchRecurringAvailabilityBlocks } from "../_lib/queries";
import { RecurringColumn } from "./_components/RecurringColumn";

export const dynamic = "force-dynamic";

type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

function buildBackHref(
  from: string | undefined,
  month: string | undefined,
  week: string | undefined
): string {
  if (from === "week" && week && /^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return `/owner/calendar?view=week&week=${week}`;
  }
  if (from === "month" && month && /^\d{4}-\d{2}$/.test(month)) {
    return `/owner/calendar?month=${month}`;
  }
  return "/owner/calendar";
}

export default async function RecurringAvailabilityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const from = typeof params.from === "string" ? params.from : undefined;
  const month = typeof params.month === "string" ? params.month : undefined;
  const week = typeof params.week === "string" ? params.week : undefined;
  const backHref = buildBackHref(from, month, week);

  const blocks = await fetchRecurringAvailabilityBlocks();

  const byWeekday = new Map<number, AvailabilityBlockRecord[]>();
  for (let i = 0; i < 7; i++) byWeekday.set(i, []);
  for (const b of blocks) {
    if (b.recurring_weekday !== null) {
      byWeekday.get(b.recurring_weekday)?.push(b);
    }
  }
  for (const list of byWeekday.values()) {
    list.sort((a, b) => {
      if (a.start_time === null && b.start_time === null) return 0;
      if (a.start_time === null) return -1;
      if (b.start_time === null) return 1;
      return a.start_time.localeCompare(b.start_time);
    });
  }

  return (
    <section>
      <header className="mb-8">
        <Link
          href={backHref}
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-body)",
          }}
        >
          ← Back to Calendar
        </Link>
        <p className="eyebrow mb-3" style={{ marginTop: 18 }}>
          Owner — Calendar
        </p>
        <h1 className="page-title">Recurring Availability</h1>
        <p
          style={{
            marginTop: 8,
            color: "var(--text-body)",
            fontSize: 14,
            maxWidth: 640,
          }}
        >
          Block off the same times every week. These apply to every matching
          day, ongoing.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          border: "1px solid var(--border)",
          backgroundColor: "var(--surface-raised)",
        }}
      >
        {Array.from({ length: 7 }, (_, i) => (
          <RecurringColumn
            key={i}
            weekday={i}
            blocks={byWeekday.get(i) ?? []}
            isLast={i === 6}
          />
        ))}
      </div>
    </section>
  );
}
