import {
  addDaysToDateKey,
  combineDateAndTimeInTimezone,
  currentMonthKey,
  monthGridDateKeys,
} from "@/app/owner/calendar/_lib/timezone";
import {
  fetchMyShoot,
  fetchMyShootsInRange,
  fetchMyUpcomingShoots,
} from "./_lib/queries";
import { ClientBookingToolbar } from "./_components/ClientBookingToolbar";
import { ClientBookingCalendar } from "./_components/ClientBookingCalendar";
import { MyShootsList } from "./_components/MyShootsList";
import { RequestShootFormPanel } from "./_components/RequestShootFormPanel";
import { MyShootDetailPanel } from "./_components/MyShootDetailPanel";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function isValidMonthKey(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return false;
  const month = Number(s.slice(5, 7));
  return month >= 1 && month <= 12;
}

function isValidDateKey(s: string | undefined): s is string {
  return Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
}

function parseMonthKey(raw: string | undefined): string {
  if (isValidMonthKey(raw)) return raw;
  return currentMonthKey();
}

function paramStr(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function ClientBookPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const monthKey = parseMonthKey(paramStr(params.month));
  const requestFlag = paramStr(params.request) === "1";
  const shootId = paramStr(params.shoot) ?? null;
  const dateHint = paramStr(params.date);
  const defaultDate = isValidDateKey(dateHint) ? dateHint : undefined;

  const baseHref = `/client/book?month=${monthKey}`;
  const closeHref = baseHref;

  const grid = monthGridDateKeys(monthKey);
  const gridStartKey = grid[0];
  const gridEndKey = addDaysToDateKey(grid[grid.length - 1], 1);
  const gridStartUtc = combineDateAndTimeInTimezone(gridStartKey, "00:00");
  const gridEndUtc = combineDateAndTimeInTimezone(gridEndKey, "00:00");

  const shootPromise = shootId
    ? fetchMyShoot(shootId)
    : Promise.resolve(null);

  const [myShoots, upcomingShoots, viewedShoot] = await Promise.all([
    fetchMyShootsInRange(gridStartUtc, gridEndUtc),
    fetchMyUpcomingShoots(),
    shootPromise,
  ]);

  // The URL contract permits both `?request=1&shoot=<id>` simultaneously.
  // When both are present, prefer the detail panel: a client looking at a
  // specific shoot shouldn't have the request form on top of it.
  const showDetail = Boolean(shootId && viewedShoot);
  const showRequest = requestFlag && !showDetail;

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Client — Calendar</p>
        <h1 className="page-title">Book a Shoot</h1>
      </header>

      <ClientBookingToolbar monthKey={monthKey} />
      <ClientBookingCalendar
        monthKey={monthKey}
        myShoots={myShoots}
        baseHref={baseHref}
      />
      <MyShootsList shoots={upcomingShoots} baseHref={baseHref} />

      {showRequest && (
        <RequestShootFormPanel
          defaultDate={defaultDate}
          closeHref={closeHref}
        />
      )}

      {showDetail && viewedShoot && (
        <MyShootDetailPanel shoot={viewedShoot} closeHref={closeHref} />
      )}
    </section>
  );
}
