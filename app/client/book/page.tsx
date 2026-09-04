import {
  addDaysToDateKey,
  combineDateAndTimeInTimezone,
  currentMonthKey,
  monthGridDateKeys,
} from "@/app/owner/calendar/_lib/timezone";
import { requireCurrentClient } from "@/lib/currentClient";
import {
  fetchMyRecentDeclines,
  fetchMyShoot,
  fetchMyShootsInRange,
  fetchMyUpcomingShoots,
} from "./_lib/queries";
import { ClientBookingToolbar } from "./_components/ClientBookingToolbar";
import { ClientBookingCalendar } from "./_components/ClientBookingCalendar";
import { RequestShootCTA } from "./_components/RequestShootCTA";
import { UpcomingShootCard } from "./_components/UpcomingShootCard";
import { RequestNewShootCard } from "./_components/RequestNewShootCard";
import { BookingFeatureCards } from "./_components/BookingFeatureCards";
import { DeclinedRequestsNotice } from "./_components/DeclinedRequestsNotice";
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
  const requestHref = `${baseHref}&request=1`;

  const grid = monthGridDateKeys(monthKey);
  const gridStartKey = grid[0];
  const gridEndKey = addDaysToDateKey(grid[grid.length - 1], 1);
  const gridStartUtc = combineDateAndTimeInTimezone(gridStartKey, "00:00");
  const gridEndUtc = combineDateAndTimeInTimezone(gridEndKey, "00:00");

  const shootPromise = shootId
    ? fetchMyShoot(shootId)
    : Promise.resolve(null);

  const [client, myShoots, upcomingShoots, recentDeclines, viewedShoot] =
    await Promise.all([
      requireCurrentClient(),
      fetchMyShootsInRange(gridStartUtc, gridEndUtc),
      fetchMyUpcomingShoots(),
      fetchMyRecentDeclines(),
      shootPromise,
    ]);

  // Display filter only: cancelled shoots stay in the DB and remain visible
  // on the owner calendar + directly via `?shoot=<id>` URLs. They're hidden
  // here because a struck-through pill for a shoot the client cancelled is
  // confusing.
  //
  // 'declined' is deliberately NOT filtered. It's Kelsey's answer to a
  // question the client asked, and hiding it was the bug: the request simply
  // vanished, reading as "it never went through" rather than "she can't make
  // that time". It renders struck through and labelled, and the notice above
  // the calendar carries her note.
  const visibleShoots = myShoots.filter((s) => s.status !== "cancelled");

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
        <p
          style={{
            marginTop: 8,
            fontSize: 14,
            color: "var(--text-body)",
          }}
        >
          Request a shoot anytime, or check the status of upcoming sessions below.
        </p>
      </header>

      <DeclinedRequestsNotice
        shoots={recentDeclines}
        requestHref={requestHref}
        baseHref={baseHref}
      />

      <RequestShootCTA href={requestHref} />

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,320px)]">
        <div>
          <ClientBookingToolbar monthKey={monthKey} />
          <ClientBookingCalendar
            monthKey={monthKey}
            myShoots={visibleShoots}
            baseHref={baseHref}
          />
        </div>
        <div className="flex flex-col gap-4">
          <UpcomingShootCard
            shoots={upcomingShoots}
            baseHref={baseHref}
            clientId={client.id}
          />
          <RequestNewShootCard href={requestHref} />
        </div>
      </div>

      <BookingFeatureCards />

      {showRequest && (
        <RequestShootFormPanel
          defaultDate={defaultDate}
          closeHref={closeHref}
        />
      )}

      {showDetail && viewedShoot && (
        <MyShootDetailPanel
          shoot={viewedShoot}
          closeHref={closeHref}
          requestHref={requestHref}
        />
      )}
    </section>
  );
}
