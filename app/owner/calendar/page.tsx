import Link from "next/link";
import { fetchClientsWithRelations } from "@/app/owner/clients/_lib/queries";
import {
  fetchShootsInRange,
  type ShootWithClientName,
} from "@/app/owner/shoots/_lib/queries";
import { MonthGrid } from "./_components/MonthGrid";
import { MonthHeader } from "./_components/MonthHeader";
import { ViewToggle } from "./_components/ViewToggle";
import { DaySidePanel } from "./_components/DaySidePanel";
import { WeekGrid } from "./_components/WeekGrid";
import { WeekHeader } from "./_components/WeekHeader";
import { fetchAvailabilityBlocksInRange } from "./_lib/queries";
import {
  addWeeks,
  currentYearMonth,
  dateKey,
  endOfWeek,
  formatMonthParam,
  formatWeekParam,
  gridRange,
  parseDateParam,
  parseMonthParam,
  parseWeekParam,
  startOfWeek,
} from "./_lib/dateMath";

export const dynamic = "force-dynamic";

type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

type View = "month" | "week";

function parseView(raw: string | undefined): View {
  return raw === "week" ? "week" : "month";
}

export default async function OwnerCalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const view = parseView(
    typeof params.view === "string" ? params.view : undefined
  );
  const dateRaw = typeof params.date === "string" ? params.date : undefined;
  const selectedDate = parseDateParam(dateRaw);

  const [clientsWithRelations] = await Promise.all([
    fetchClientsWithRelations(),
  ]);
  const clients = clientsWithRelations.map(({ client }) => ({
    id: client.id,
    name: client.name,
  }));

  if (view === "week") {
    const weekRaw = typeof params.week === "string" ? params.week : undefined;
    const weekStart = parseWeekParam(weekRaw);
    const weekEnd = endOfWeek(weekStart);
    const weekParam = formatWeekParam(weekStart);

    const [shoots, blocks] = await Promise.all([
      fetchShootsInRange(weekStart, weekEnd),
      fetchAvailabilityBlocksInRange(weekStart, weekEnd),
    ]);

    const selectedKey = selectedDate ? dateKey(selectedDate) : null;
    const shootsForDay: ShootWithClientName[] = selectedKey
      ? shoots.filter(
          (s) => dateKey(new Date(s.scheduled_at)) === selectedKey
        )
      : [];

    // Toggle: Week → Month uses month containing weekStart.
    const monthHref = `/owner/calendar?month=${formatMonthParam({
      year: weekStart.getFullYear(),
      month: weekStart.getMonth(),
    })}`;
    const weekHref = `/owner/calendar?view=week&week=${weekParam}`;
    const closeHref = `/owner/calendar?view=week&week=${weekParam}`;

    return (
      <section>
        <header className="mb-8 flex items-start justify-between gap-6">
          <div>
            <p className="eyebrow mb-3">Owner — Calendar</p>
            <h1 className="page-title">Calendar</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link
              href={`/owner/calendar/recurring?from=week&week=${weekParam}`}
              className="calendar-toolbar-link"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "8px 18px",
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                border: "1px solid var(--border)",
                backgroundColor: "transparent",
                color: "var(--text-body)",
              }}
            >
              Recurring Hours
            </Link>
            <ViewToggle
              active="week"
              monthHref={monthHref}
              weekHref={weekHref}
            />
          </div>
        </header>

        <WeekHeader weekStart={weekStart} />
        <WeekGrid
          weekStart={weekStart}
          shoots={shoots}
          blocks={blocks}
          clients={clients}
        />

        <DaySidePanel
          selectedDate={selectedDate}
          shootsForDay={shootsForDay}
          clients={clients}
          closeHref={closeHref}
          blocks={blocks}
        />

        <style>{`
          .calendar-toolbar-link:hover {
            background-color: var(--surface-raised);
          }
        `}</style>
      </section>
    );
  }

  // Month view (default)
  const monthRaw = typeof params.month === "string" ? params.month : undefined;
  const ym = parseMonthParam(monthRaw);
  const monthParam = formatMonthParam(ym);
  const { start, end } = gridRange(ym);

  const [shoots, blocks] = await Promise.all([
    fetchShootsInRange(start, end),
    fetchAvailabilityBlocksInRange(start, end),
  ]);

  const selectedKey = selectedDate ? dateKey(selectedDate) : null;
  const shootsForDay: ShootWithClientName[] = selectedKey
    ? shoots.filter((s) => dateKey(new Date(s.scheduled_at)) === selectedKey)
    : [];

  // Toggle: Month → Week.
  // If displayed month is the current month, jump to today's week (most useful).
  // Otherwise, use the Sunday of the week containing the 1st of the displayed month.
  const today = new Date();
  const isCurrentMonth = currentYearMonth(today).year === ym.year &&
    currentYearMonth(today).month === ym.month;
  const weekTarget = isCurrentMonth
    ? startOfWeek(today)
    : startOfWeek(new Date(ym.year, ym.month, 1));
  // Guard: if the 1st-of-month's Sunday falls in the previous month, push
  // forward a week so the week view lands cleanly inside the displayed month.
  const adjustedWeekTarget =
    !isCurrentMonth && weekTarget.getMonth() !== ym.month
      ? addWeeks(weekTarget, 1)
      : weekTarget;
  const monthHref = `/owner/calendar?month=${monthParam}`;
  const weekHref = `/owner/calendar?view=week&week=${formatWeekParam(adjustedWeekTarget)}`;
  const closeHref = `/owner/calendar?month=${monthParam}`;

  return (
    <section>
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <p className="eyebrow mb-3">Owner — Calendar</p>
          <h1 className="page-title">Calendar</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            href={`/owner/calendar/recurring?from=month&month=${monthParam}`}
            className="calendar-toolbar-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "8px 18px",
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              border: "1px solid var(--border)",
              backgroundColor: "transparent",
              color: "var(--text-body)",
            }}
          >
            Recurring Hours
          </Link>
          <ViewToggle
            active="month"
            monthHref={monthHref}
            weekHref={weekHref}
          />
        </div>
      </header>

      <MonthHeader ym={ym} />
      <MonthGrid
        ym={ym}
        shoots={shoots}
        blocks={blocks}
        selectedDateKey={selectedKey}
      />

      <DaySidePanel
        selectedDate={selectedDate}
        shootsForDay={shootsForDay}
        clients={clients}
        closeHref={closeHref}
        blocks={blocks}
      />

      <style>{`
        .calendar-toolbar-link:hover {
          background-color: var(--surface-raised);
        }
      `}</style>
    </section>
  );
}
