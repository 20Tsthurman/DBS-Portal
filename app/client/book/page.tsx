import {
  dateKey,
  formatMonthParam,
  gridRange,
  parseDateParam,
  parseMonthParam,
} from "@/app/owner/calendar/_lib/dateMath";
import { blocksForDate } from "@/app/owner/calendar/_lib/queries";
import {
  fetchAvailabilityBlocksForClient,
  fetchMyShootsInRange,
} from "./_lib/queries";
import { ClientMonthHeader } from "./_components/ClientMonthHeader";
import { ClientMonthGrid } from "./_components/ClientMonthGrid";
import { ClientDaySidePanel } from "./_components/ClientDaySidePanel";

export const dynamic = "force-dynamic";

type SearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export default async function ClientBookPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const monthRaw = typeof params.month === "string" ? params.month : undefined;
  const dateRaw = typeof params.date === "string" ? params.date : undefined;

  const ym = parseMonthParam(monthRaw);
  const monthParam = formatMonthParam(ym);
  const { start, end } = gridRange(ym);

  const [myShoots, blocks] = await Promise.all([
    fetchMyShootsInRange(start, end),
    fetchAvailabilityBlocksForClient(start, end),
  ]);

  const selectedDate = parseDateParam(dateRaw);
  const selectedKey = selectedDate ? dateKey(selectedDate) : null;

  const myShootsForDay = selectedKey
    ? myShoots.filter((s) => dateKey(new Date(s.scheduled_at)) === selectedKey)
    : [];
  const blocksForDay = selectedDate
    ? blocksForDate(blocks, selectedDate)
    : [];

  return (
    <section>
      <header className="mb-8">
        <p className="eyebrow mb-3">Client — Calendar</p>
        <h1 className="page-title">Book a Shoot</h1>
        <p
          style={{
            marginTop: 8,
            color: "var(--text-body)",
            fontSize: 14,
          }}
        >
          View your scheduled shoots and request new ones.
        </p>
      </header>

      <ClientMonthHeader ym={ym} />
      <ClientMonthGrid
        ym={ym}
        myShoots={myShoots}
        blocks={blocks}
        selectedDateKey={selectedKey}
      />

      <ClientDaySidePanel
        selectedDate={selectedDate}
        myShootsForDay={myShootsForDay}
        blocksForDay={blocksForDay}
        monthParam={monthParam}
      />
    </section>
  );
}
