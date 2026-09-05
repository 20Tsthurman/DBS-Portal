import type { CSSProperties } from "react";
import { requireCurrentClient } from "@/lib/currentClient";
import type { ProjectPhase } from "@/lib/supabase";
import { fetchMyUpcomingShoots } from "@/app/client/book/_lib/queries";
import { fetchMyInvoices } from "@/app/client/invoices/_lib/queries";
import { fetchMyFiles } from "@/app/client/files/_lib/queries";
import {
  fetchClientOnboardingTourSeen,
  fetchMyLastMessage,
  fetchMyProject,
} from "./_lib/queries";
import { PhaseTracker } from "./_components/PhaseTracker";
import { NextShoot } from "./_components/NextShoot";
import { ActivityFeed } from "./_components/ActivityFeed";
import { ClientOnboardingTour } from "./_components/ClientOnboardingTour";

export const dynamic = "force-dynamic";

export default async function ClientDashboardPage() {
  const client = await requireCurrentClient();

  // fetchMyUpcomingShoots scopes by the signed-in client itself; the others
  // take client.id directly. All run concurrently.
  //
  // The tour gate rides along here rather than in a useEffect on the client.
  // Two reasons it has to be server-side, and in this position specifically:
  // it is downstream of the `requireCurrentClient()` await above, so a client
  // whose Clerk webhook has not linked their `clients` row yet takes the
  // throw → app/client/error.tsx path and never renders the tour at all; and
  // resolving it before paint means the tour either starts or doesn't, with
  // no flash of a spotlight over a dashboard the client has already read.
  const [upcomingShoots, invoices, files, lastMessage, project, tourSeen] =
    await Promise.all([
      fetchMyUpcomingShoots(),
      fetchMyInvoices(client.id),
      fetchMyFiles(client.id),
      fetchMyLastMessage(client.id),
      fetchMyProject(client.id),
      // clerk_user_id is non-null in practice — this row was found BY that
      // column — but it is nullable in the schema. Treat an absent id as
      // "already seen": there is no id to write a completion row against, so
      // firing the tour would only produce one that can never be recorded.
      client.clerk_user_id
        ? fetchClientOnboardingTourSeen(client.clerk_user_id)
        : Promise.resolve(true),
    ]);

  const firstName = client.name.trim().split(/\s+/)[0] || client.name;
  const nextShoot = upcomingShoots[0] ?? null;
  const lastInvoice = invoices[0] ?? null;
  const lastFile = files[0] ?? null;

  // A client with no projects row has not been moved anywhere. Every writer
  // (the invite route, Add Client, and the notes and pricing actions) inserts
  // the row at 'onboarding' and the column defaults there, so "no row" and
  // "onboarding" are the same fact — the row just hasn't been needed yet. A
  // package-less invite is the ordinary way to land here. Resolved on the
  // page so the tracker only ever sees a real phase.
  const phase: ProjectPhase = project?.current_phase ?? "onboarding";
  // Nothing in the app writes 'completed' today — every insert is 'active'
  // and no update touches status — but the CHECK admits it, and a hand-set
  // completed project must not render as in progress.
  const projectCompleted = project?.status === "completed";

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Client — My Project</p>
        <h1 className="page-title">Hi {firstName}, here&apos;s where things stand.</h1>
      </header>

      <div style={sectionsStyle}>
        <section>
          <h2 style={sectionTitleStyle}>Your Project</h2>
          <PhaseTracker phase={phase} completed={projectCompleted} />
        </section>

        {/* The tour anchors on this <section>, not inside NextShoot, so the
            step highlights the heading with the card and reads identically
            whether or not a shoot is scheduled — NextShoot returns a card or
            an empty state, and one anchor beats two. */}
        <section data-tour="next-shoot">
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

      <ClientOnboardingTour show={!tourSeen} />
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
