import { currentMonthKey } from "@/app/owner/calendar/_lib/timezone";
import { ClientFilterSelect } from "./_components/ClientFilterSelect";
import { ContentBoard } from "./_components/ContentBoard";
import { MonthStepper } from "./_components/MonthStepper";
import { ViewToggle } from "./_components/ViewToggle";
import {
  contentItemToEvent,
  type ContentCalendarEvent,
} from "./_lib/calendarEvents";
import { buildCalendarThumbUrls } from "./_lib/calendarThumbs";
import type { ContentView } from "./_lib/href";
import {
  evaluateReleaseGate,
  evaluateRereleaseGate,
  type ReleaseGateResult,
  type RereleaseGateResult,
} from "./_lib/releaseGate";
import { fetchCycleRollup, type CycleRollup } from "./_lib/rollup";
import {
  fetchContentClients,
  fetchCyclesForMonth,
  fetchItemsForCycles,
} from "./_lib/queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ clientId?: string; month?: string; view?: string }>;
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function parseMonthKey(raw: unknown): string {
  if (typeof raw === "string" && MONTH_KEY_RE.test(raw)) return raw;
  return currentMonthKey();
}

/** Calendar is the default (spec §4.1: Kelsey works in a calendar view). */
function parseView(raw: unknown): ContentView {
  return raw === "list" ? "list" : "calendar";
}

export default async function OwnerContentPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const monthKey = parseMonthKey(params.month);
  const view = parseView(params.view);

  const clients = await fetchContentClients();
  // A clientId that isn't in the roster (stale link, deactivated client)
  // falls back to the all-clients view rather than rendering an empty page
  // that looks like missing data.
  const requestedClientId = params.clientId ?? null;
  const activeClient =
    clients.find((c) => c.id === requestedClientId) ?? null;
  const clientId = activeClient?.id ?? null;

  const cycles = await fetchCyclesForMonth(monthKey, clientId ?? undefined);
  const items = await fetchItemsForCycles(cycles.map((c) => c.id));

  // Release readiness for the cycle bar's button. Computed here so the button
  // starts out in the right state instead of flashing enabled, and computed
  // ONLY for a drafting cycle — a released or locked one has no Release
  // button to gate.
  //
  // This is the hint, not the decision. `releaseContentCycleAction` runs the
  // same gate again against its own queries when Kelsey presses, because this
  // value is stale the moment a video finishes transcoding and nothing
  // re-renders the page to say so.
  const activeCycle = clientId ? (cycles[0] ?? null) : null;
  let releaseGate: ReleaseGateResult | null = null;
  if (activeCycle && activeCycle.status === "drafting") {
    releaseGate = await evaluateReleaseGate(activeCycle);
  }

  // Client progress for a released month (spec 4.5). Server-rendered so the
  // strip has real numbers on first paint; `ContentRollup` polls the same
  // computation afterwards.
  //
  // Re-release readiness rides alongside it, for the same cycle state and
  // with the same hint-not-decision caveat as `releaseGate` above:
  // `rereleaseContentCycleAction` re-runs the gate after the press.
  let rollup: CycleRollup | null = null;
  let rereleaseGate: RereleaseGateResult | null = null;
  if (activeCycle && activeCycle.status === "in_review") {
    rollup = await fetchCycleRollup(activeCycle.id);
    rereleaseGate = await evaluateRereleaseGate(activeCycle);
  }

  // Thumbnail minting is calendar-only work — the list view renders no
  // media, so it skips the signed-URL round-trip entirely.
  let events: ContentCalendarEvent[] = [];
  if (view === "calendar") {
    const thumbUrls = await buildCalendarThumbUrls(items);
    events = items.map((item) => contentItemToEvent(item, thumbUrls));
  }

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <h1 className="page-title">Content</h1>
        <p style={{ marginTop: 8, fontSize: 14, color: "var(--text-body)" }}>
          Build a month of posts privately. Nothing here is visible to a client
          until the month is released.
        </p>
      </header>

      {/* One toolbar row at desktop width; the client filter drops to its
          own full-width row on mobile via its order-last/w-full classes. */}
      <div className="flex flex-wrap items-center gap-x-4">
        <MonthStepper monthKey={monthKey} clientId={clientId} view={view} />
        <ClientFilterSelect
          clients={clients}
          activeClientId={clientId}
          monthKey={monthKey}
          view={view}
        />
        <div className="ml-auto">
          <ViewToggle view={view} monthKey={monthKey} clientId={clientId} />
        </div>
      </div>

      <ContentBoard
        items={items}
        cycles={cycles}
        clientId={clientId}
        clientName={activeClient?.name ?? ""}
        monthKey={monthKey}
        view={view}
        events={events}
        releaseGate={releaseGate}
        rereleaseGate={rereleaseGate}
        rollup={rollup}
      />
    </section>
  );
}
