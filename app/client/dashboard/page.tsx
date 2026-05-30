import type { CSSProperties } from "react";
import { requireCurrentClient } from "@/lib/currentClient";
import { fetchMyUpcomingShoots } from "@/app/client/book/_lib/queries";
import { fetchMyInvoices } from "@/app/client/invoices/_lib/queries";
import { fetchMyFiles } from "@/app/client/files/_lib/queries";
import { fetchMyProject, fetchMyLastMessage } from "./_lib/queries";
import { PhaseTracker } from "./_components/PhaseTracker";
import { NextShoot } from "./_components/NextShoot";
import { ActivityFeed } from "./_components/ActivityFeed";

export const dynamic = "force-dynamic";

export default async function ClientDashboardPage() {
  const client = await requireCurrentClient();

  // fetchMyUpcomingShoots scopes by the signed-in client itself; the others
  // take client.id directly. All run concurrently.
  const [project, upcomingShoots, invoices, files, lastMessage] =
    await Promise.all([
      fetchMyProject(client.id),
      fetchMyUpcomingShoots(),
      fetchMyInvoices(client.id),
      fetchMyFiles(client.id),
      fetchMyLastMessage(client.id),
    ]);

  const firstName = client.name.trim().split(/\s+/)[0] || client.name;
  const nextShoot = upcomingShoots[0] ?? null;
  const lastInvoice = invoices[0] ?? null;
  const lastFile = files[0] ?? null;

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Client — My Project</p>
        <h1 className="page-title">Hi {firstName}, here&apos;s where things stand.</h1>
      </header>

      <div style={sectionsStyle}>
        <section>
          <h2 style={sectionTitleStyle}>Project Phase</h2>
          <PhaseTracker currentPhase={project?.current_phase ?? null} />
        </section>

        <section>
          <h2 style={sectionTitleStyle}>Next Shoot</h2>
          <NextShoot shoot={nextShoot} />
        </section>

        <section>
          <h2 style={sectionTitleStyle}>Recent Activity</h2>
          <ActivityFeed
            lastInvoice={lastInvoice}
            lastFile={lastFile}
            lastMessage={lastMessage}
          />
        </section>
      </div>
    </section>
  );
}

const sectionsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 32,
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 22,
  fontWeight: 500,
  color: "var(--text-primary)",
  letterSpacing: "-0.01em",
  margin: "0 0 12px",
};
