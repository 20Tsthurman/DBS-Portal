import { currentMonthKey } from "@/app/owner/calendar/_lib/timezone";
import { ClientFilterPills } from "./_components/ClientFilterPills";
import { ContentBoard } from "./_components/ContentBoard";
import { MonthStepper } from "./_components/MonthStepper";
import {
  fetchContentClients,
  fetchCyclesForMonth,
  fetchItemsForCycles,
} from "./_lib/queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ clientId?: string; month?: string }>;
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function parseMonthKey(raw: unknown): string {
  if (typeof raw === "string" && MONTH_KEY_RE.test(raw)) return raw;
  return currentMonthKey();
}

export default async function OwnerContentPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const monthKey = parseMonthKey(params.month);

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

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <h1 className="page-title">Content</h1>
        <p style={{ marginTop: 8, fontSize: 14, color: "var(--text-body)" }}>
          Build a month of posts privately. Nothing here is visible to a client
          until the month is released.
        </p>
      </header>

      <div className="flex flex-col">
        <MonthStepper monthKey={monthKey} clientId={clientId} />
        <ClientFilterPills
          clients={clients}
          activeClientId={clientId}
          monthKey={monthKey}
        />
      </div>

      <ContentBoard
        items={items}
        cycles={cycles}
        clientId={clientId}
        clientName={activeClient?.name ?? ""}
        monthKey={monthKey}
      />
    </section>
  );
}
