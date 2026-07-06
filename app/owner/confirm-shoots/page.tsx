/**
 * /owner/confirm-shoots — the Stage 2 shoot-capture review queue.
 *
 * Google events whose title matches shoot|content land here as pending
 * candidates (flagged during sync, see lib/google/sync.ts). Kelsey picks the
 * client (required), optionally fixes the location text, and Confirm creates
 * a real shoots row through the existing createShoot action — after which
 * the shoot feeds the normal mileage-suggestion pipeline. "Not a shoot"
 * dismisses the candidate back to a plain busy event, permanently.
 *
 * Page auth: relies on the owner-only guard in app/owner/layout.tsx.
 */

import { fetchClientsLite } from "@/app/owner/calendar/_lib/queries";
import { GoogleSyncOnView } from "@/app/owner/calendar/_components/GoogleSyncOnView";
import { CandidateList } from "./_components/CandidateList";
import { fetchPendingCandidates } from "./_lib/queries";

export const dynamic = "force-dynamic";

export default async function ConfirmShootsPage() {
  const [candidates, clients] = await Promise.all([
    fetchPendingCandidates(),
    fetchClientsLite(),
  ]);

  return (
    <section style={{ maxWidth: 860 }}>
      {/* Same sync-on-view trigger as the calendar — new Google events
          titled Shoot/Content appear without waiting for the cron. */}
      <GoogleSyncOnView />
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Owner — Confirm Shoots</p>
        <h1 className="page-title">Confirm Shoots</h1>
        <p
          style={{
            marginTop: 8,
            fontSize: 14,
            color: "var(--text-muted)",
            lineHeight: 1.5,
          }}
        >
          Google Calendar events titled with &ldquo;Shoot&rdquo; or
          &ldquo;Content&rdquo; wait here until you pick the client. Confirming
          creates the shoot (and its mileage suggestion once the date passes);
          dismissing keeps it as a plain calendar event.
        </p>
      </header>
      <CandidateList candidates={candidates} clients={clients} />
    </section>
  );
}
