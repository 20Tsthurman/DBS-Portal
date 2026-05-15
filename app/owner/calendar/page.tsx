import { Placeholder } from "@/components/ui/Placeholder";
import { fetchEventsInRange } from "./_lib/queries";
import {
  addDaysToDateKey,
  combineDateAndTimeInTimezone,
  weekStartKeyForDate,
} from "./_lib/timezone";
import { WeekView } from "./_components/WeekView";
import { WeekToolbar } from "./_components/WeekToolbar";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type View = "week" | "month" | "agenda";

function parseView(raw: string | undefined): View {
  if (raw === "month" || raw === "agenda") return raw;
  return "week";
}

function parseWeekKey(raw: string | undefined): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    // Normalize to the Sunday of whichever week the parsed date sits in,
    // so a deep link to a Wednesday still lands on a clean week.
    const probe = combineDateAndTimeInTimezone(raw, "12:00");
    return weekStartKeyForDate(probe);
  }
  return weekStartKeyForDate(new Date());
}

export default async function OwnerCalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const view = parseView(typeof params.view === "string" ? params.view : undefined);

  if (view === "month") {
    return (
      <CalendarHeader>
        <Placeholder
          eyebrow="Owner — Calendar"
          title="Month view"
          description="Month view lands in the next phase. Use Week for now."
        />
      </CalendarHeader>
    );
  }

  if (view === "agenda") {
    return (
      <CalendarHeader>
        <Placeholder
          eyebrow="Owner — Calendar"
          title="Agenda view"
          description="Agenda view lands in the next phase. Use Week for now."
        />
      </CalendarHeader>
    );
  }

  const weekStartKey = parseWeekKey(
    typeof params.week === "string" ? params.week : undefined
  );
  const weekEndKey = addDaysToDateKey(weekStartKey, 7);
  const weekStartUtc = combineDateAndTimeInTimezone(weekStartKey, "00:00");
  const weekEndUtc = combineDateAndTimeInTimezone(weekEndKey, "00:00");

  const events = await fetchEventsInRange(weekStartUtc, weekEndUtc);

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Owner — Calendar</p>
        <h1 className="page-title">Calendar</h1>
      </header>
      <WeekToolbar weekStartKey={weekStartKey} />
      <WeekView weekStartKey={weekStartKey} events={events} />
    </section>
  );
}

function CalendarHeader({ children }: { children: React.ReactNode }) {
  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Owner — Calendar</p>
        <h1 className="page-title">Calendar</h1>
      </header>
      <WeekToolbar weekStartKey={weekStartKeyForDate(new Date())} />
      {children}
    </section>
  );
}
