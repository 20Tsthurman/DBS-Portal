import type { TimeBlockCategory } from "@/lib/supabase";
import {
  fetchClientsLite,
  fetchEventsInRange,
  fetchShoot,
  fetchTimeBlock,
} from "./_lib/queries";
import {
  addDaysToDateKey,
  combineDateAndTimeInTimezone,
  currentMonthKey,
  dateKeyInTimezone,
  monthGridDateKeys,
  weekStartKeyForDate,
} from "./_lib/timezone";
import { WeekView } from "./_components/WeekView";
import { WeekToolbar } from "./_components/WeekToolbar";
import { MonthView } from "./_components/MonthView";
import { MonthToolbar } from "./_components/MonthToolbar";
import { AgendaView } from "./_components/AgendaView";
import { AgendaToolbar } from "./_components/AgendaToolbar";
import { DayPanel } from "./_components/DayPanel";
import { TimeBlockFormPanel } from "./_components/TimeBlockFormPanel";
import { EditShootPanel } from "./_components/EditShootPanel";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type View = "week" | "month" | "agenda";

const VALID_CATEGORIES: TimeBlockCategory[] = [
  "sonography",
  "work_block",
  "blocked",
];

function parseView(raw: string | undefined): View {
  if (raw === "month" || raw === "agenda") return raw;
  return "week";
}

function isValidDateKey(s: string | undefined): s is string {
  return Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
}

function isValidMonthKey(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return false;
  const month = Number(s.slice(5, 7));
  return month >= 1 && month <= 12;
}

function parseWeekKey(raw: string | undefined): string {
  if (isValidDateKey(raw)) {
    // Normalize to the Sunday of whichever week the parsed date sits in,
    // so a deep link to a Wednesday still lands on a clean week.
    const probe = combineDateAndTimeInTimezone(raw, "12:00");
    return weekStartKeyForDate(probe);
  }
  return weekStartKeyForDate(new Date());
}

function parseMonthKey(raw: string | undefined): string {
  if (isValidMonthKey(raw)) return raw;
  return currentMonthKey();
}

function parseEditParam(
  raw: string | undefined
): { kind: "shoot" | "time_block"; id: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx === -1) return null;
  const kind = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (kind !== "shoot" && kind !== "time_block") return null;
  if (!id) return null;
  return { kind, id };
}

function parseCategoryDefault(
  raw: string | undefined
): TimeBlockCategory | undefined {
  if (!raw) return undefined;
  return VALID_CATEGORIES.includes(raw as TimeBlockCategory)
    ? (raw as TimeBlockCategory)
    : undefined;
}

function paramStr(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function OwnerCalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const view = parseView(paramStr(params.view));

  if (view === "agenda") {
    return renderAgendaView(params);
  }

  if (view === "month") {
    return renderMonthView(params);
  }

  return renderWeekView(params);
}

const AGENDA_DEFAULT_DAYS = 14;
const AGENDA_MIN_DAYS = 1;
const AGENDA_MAX_DAYS = 60;

function parseAgendaDays(raw: string | undefined): number {
  if (!raw) return AGENDA_DEFAULT_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return AGENDA_DEFAULT_DAYS;
  return Math.max(AGENDA_MIN_DAYS, Math.min(AGENDA_MAX_DAYS, n));
}

async function renderWeekView(
  params: Record<string, string | string[] | undefined>
) {
  const weekStartKey = parseWeekKey(paramStr(params.week));
  const weekEndKey = addDaysToDateKey(weekStartKey, 7);
  const weekStartUtc = combineDateAndTimeInTimezone(weekStartKey, "00:00");
  const weekEndUtc = combineDateAndTimeInTimezone(weekEndKey, "00:00");

  const dateRaw = paramStr(params.date);
  const dateKey = isValidDateKey(dateRaw) ? dateRaw : null;

  const editParam = parseEditParam(paramStr(params.edit));
  const newParam = paramStr(params.new) === "time_block" ? "time_block" : null;
  const blockCategory = parseCategoryDefault(paramStr(params.block_category));

  const eventsPromise = fetchEventsInRange(weekStartUtc, weekEndUtc);

  const formPanelActive = Boolean(editParam || newParam);
  const clientsPromise = formPanelActive
    ? fetchClientsLite()
    : Promise.resolve([] as Array<{ id: string; name: string }>);
  const editShootPromise =
    editParam?.kind === "shoot" ? fetchShoot(editParam.id) : Promise.resolve(null);
  const editTimeBlockPromise =
    editParam?.kind === "time_block"
      ? fetchTimeBlock(editParam.id)
      : Promise.resolve(null);

  const [events, clients, editShoot, editTimeBlock] = await Promise.all([
    eventsPromise,
    clientsPromise,
    editShootPromise,
    editTimeBlockPromise,
  ]);

  const dayEvents = dateKey
    ? events.filter((e) => e.dateKey === dateKey)
    : [];

  const baseHref = `/owner/calendar?view=week&week=${weekStartKey}`;
  const dayCloseHref = dateKey ? `${baseHref}&date=${dateKey}` : baseHref;

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Owner — Calendar</p>
        <h1 className="page-title">Calendar</h1>
      </header>
      <WeekToolbar weekStartKey={weekStartKey} />
      <WeekView weekStartKey={weekStartKey} events={events} />

      {dateKey && (
        <DayPanel
          baseHref={baseHref}
          dateKey={dateKey}
          events={dayEvents}
        />
      )}

      {newParam === "time_block" && (
        <TimeBlockFormPanel
          mode="create"
          defaultDate={dateKey ?? undefined}
          defaultCategory={blockCategory}
          clients={clients}
          closeHref={dayCloseHref}
        />
      )}

      {editParam?.kind === "time_block" && editTimeBlock && (
        <TimeBlockFormPanel
          mode="edit"
          existing={editTimeBlock}
          clients={clients}
          closeHref={dayCloseHref}
        />
      )}

      {editParam?.kind === "shoot" && editShoot && (
        <EditShootPanel
          shoot={editShoot}
          clients={clients}
          closeHref={dayCloseHref}
        />
      )}
    </section>
  );
}

async function renderMonthView(
  params: Record<string, string | string[] | undefined>
) {
  const monthKey = parseMonthKey(paramStr(params.month));
  const grid = monthGridDateKeys(monthKey);
  const gridStartKey = grid[0];
  const gridEndKey = addDaysToDateKey(grid[grid.length - 1], 1);
  const gridStartUtc = combineDateAndTimeInTimezone(gridStartKey, "00:00");
  const gridEndUtc = combineDateAndTimeInTimezone(gridEndKey, "00:00");

  const dateRaw = paramStr(params.date);
  const dateKey = isValidDateKey(dateRaw) ? dateRaw : null;

  const editParam = parseEditParam(paramStr(params.edit));
  const newParam = paramStr(params.new) === "time_block" ? "time_block" : null;
  const blockCategory = parseCategoryDefault(paramStr(params.block_category));

  const eventsPromise = fetchEventsInRange(gridStartUtc, gridEndUtc);

  const formPanelActive = Boolean(editParam || newParam);
  const clientsPromise = formPanelActive
    ? fetchClientsLite()
    : Promise.resolve([] as Array<{ id: string; name: string }>);
  const editShootPromise =
    editParam?.kind === "shoot" ? fetchShoot(editParam.id) : Promise.resolve(null);
  const editTimeBlockPromise =
    editParam?.kind === "time_block"
      ? fetchTimeBlock(editParam.id)
      : Promise.resolve(null);

  const [events, clients, editShoot, editTimeBlock] = await Promise.all([
    eventsPromise,
    clientsPromise,
    editShootPromise,
    editTimeBlockPromise,
  ]);

  const dayEvents = dateKey
    ? events.filter((e) => e.dateKey === dateKey)
    : [];

  const baseHref = `/owner/calendar?view=month&month=${monthKey}`;
  const dayCloseHref = dateKey ? `${baseHref}&date=${dateKey}` : baseHref;

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Owner — Calendar</p>
        <h1 className="page-title">Calendar</h1>
      </header>
      <MonthToolbar monthKey={monthKey} />
      <MonthView monthKey={monthKey} events={events} />

      {dateKey && (
        <DayPanel
          baseHref={baseHref}
          dateKey={dateKey}
          events={dayEvents}
        />
      )}

      {newParam === "time_block" && (
        <TimeBlockFormPanel
          mode="create"
          defaultDate={dateKey ?? undefined}
          defaultCategory={blockCategory}
          clients={clients}
          closeHref={dayCloseHref}
        />
      )}

      {editParam?.kind === "time_block" && editTimeBlock && (
        <TimeBlockFormPanel
          mode="edit"
          existing={editTimeBlock}
          clients={clients}
          closeHref={dayCloseHref}
        />
      )}

      {editParam?.kind === "shoot" && editShoot && (
        <EditShootPanel
          shoot={editShoot}
          clients={clients}
          closeHref={dayCloseHref}
        />
      )}
    </section>
  );
}

async function renderAgendaView(
  params: Record<string, string | string[] | undefined>
) {
  const startRaw = paramStr(params.start);
  const startDateKey = isValidDateKey(startRaw)
    ? startRaw
    : dateKeyInTimezone(new Date());
  const days = parseAgendaDays(paramStr(params.days));

  const endDateKey = addDaysToDateKey(startDateKey, days);
  const rangeStartUtc = combineDateAndTimeInTimezone(startDateKey, "00:00");
  const rangeEndUtc = combineDateAndTimeInTimezone(endDateKey, "00:00");

  const dateRaw = paramStr(params.date);
  const dateKey = isValidDateKey(dateRaw) ? dateRaw : null;

  const editParam = parseEditParam(paramStr(params.edit));
  const newParam = paramStr(params.new) === "time_block" ? "time_block" : null;
  const blockCategory = parseCategoryDefault(paramStr(params.block_category));

  const eventsPromise = fetchEventsInRange(rangeStartUtc, rangeEndUtc);

  const formPanelActive = Boolean(editParam || newParam);
  const clientsPromise = formPanelActive
    ? fetchClientsLite()
    : Promise.resolve([] as Array<{ id: string; name: string }>);
  const editShootPromise =
    editParam?.kind === "shoot" ? fetchShoot(editParam.id) : Promise.resolve(null);
  const editTimeBlockPromise =
    editParam?.kind === "time_block"
      ? fetchTimeBlock(editParam.id)
      : Promise.resolve(null);

  const [events, clients, editShoot, editTimeBlock] = await Promise.all([
    eventsPromise,
    clientsPromise,
    editShootPromise,
    editTimeBlockPromise,
  ]);

  const dayEvents = dateKey
    ? events.filter((e) => e.dateKey === dateKey)
    : [];

  const baseHref = `/owner/calendar?view=agenda&start=${startDateKey}`;
  const dayCloseHref = dateKey ? `${baseHref}&date=${dateKey}` : baseHref;

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Owner — Calendar</p>
        <h1 className="page-title">Calendar</h1>
      </header>
      <AgendaToolbar startDateKey={startDateKey} days={days} />
      <AgendaView
        startDateKey={startDateKey}
        days={days}
        events={events}
        baseHref={baseHref}
      />

      {dateKey && (
        <DayPanel
          baseHref={baseHref}
          dateKey={dateKey}
          events={dayEvents}
        />
      )}

      {newParam === "time_block" && (
        <TimeBlockFormPanel
          mode="create"
          defaultDate={dateKey ?? undefined}
          defaultCategory={blockCategory}
          clients={clients}
          closeHref={dayCloseHref}
        />
      )}

      {editParam?.kind === "time_block" && editTimeBlock && (
        <TimeBlockFormPanel
          mode="edit"
          existing={editTimeBlock}
          clients={clients}
          closeHref={dayCloseHref}
        />
      )}

      {editParam?.kind === "shoot" && editShoot && (
        <EditShootPanel
          shoot={editShoot}
          clients={clients}
          closeHref={dayCloseHref}
        />
      )}
    </section>
  );
}
