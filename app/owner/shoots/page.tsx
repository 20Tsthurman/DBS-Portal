import { StatusPill } from "@/components/ui/StatusPill";
import {
  formatDateTime,
  formatHours,
} from "@/app/owner/clients/_lib/format";
import { fetchClientsWithRelations } from "@/app/owner/clients/_lib/queries";
import {
  fetchPastShoots,
  fetchUpcomingShoots,
  type ShootWithClientName,
} from "./_lib/queries";
import { shootStatusLabel, shootStatusTone } from "./_lib/format";
import { AddShootButton } from "./_components/AddShootButton";
import { ShootRowActions } from "./_components/ShootRowActions";

export const dynamic = "force-dynamic";

export default async function OwnerShootsPage() {
  const [upcoming, past, clientsWithRelations] = await Promise.all([
    fetchUpcomingShoots(),
    fetchPastShoots(),
    fetchClientsWithRelations(),
  ]);

  const clients = clientsWithRelations.map(({ client }) => ({
    id: client.id,
    name: client.name,
  }));

  return (
    <section>
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <p className="eyebrow mb-3">Owner — Shoots</p>
          <h1 className="page-title">Shoots</h1>
          <p
            style={{
              marginTop: 8,
              color: "var(--text-body)",
              fontSize: 14,
            }}
          >
            Manage upcoming and past shoots.
          </p>
        </div>
        <AddShootButton clients={clients} />
      </header>

      <ShootSection
        title="Upcoming"
        rows={upcoming}
        emptyText="No upcoming shoots."
        clients={clients}
      />
      <div style={{ height: 32 }} />
      <ShootSection
        title="Past"
        rows={past}
        emptyText="No past shoots yet."
        clients={clients}
      />

      <style>{`
        .row-hover:hover td {
          background-color: var(--surface-base);
        }
      `}</style>
    </section>
  );
}

function ShootSection({
  title,
  rows,
  emptyText,
  clients,
}: {
  title: string;
  rows: ShootWithClientName[];
  emptyText: string;
  clients: { id: string; name: string }[];
}) {
  return (
    <div>
      <h2
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: 22,
          fontWeight: 500,
          color: "var(--text-primary)",
          marginBottom: 16,
        }}
      >
        {title}
      </h2>
      {rows.length === 0 ? (
        <div
          className="border px-6 py-10 text-center"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-raised)",
            color: "var(--text-body)",
            fontSize: 14,
          }}
        >
          {emptyText}
        </div>
      ) : (
        <div
          className="border"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-raised)",
          }}
        >
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Date &amp; Time</th>
                <th>Location</th>
                <th>Duration</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((shoot) => {
                const rowOpacity =
                  shoot.status === "cancelled"
                    ? 0.6
                    : shoot.status === "completed"
                      ? 0.7
                      : 1;
                return (
                <tr
                  key={shoot.id}
                  className="row-hover"
                  style={{ opacity: rowOpacity }}
                >

                  <td style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {shoot.client_name || "—"}
                  </td>
                  <td>{formatDateTime(shoot.scheduled_at)}</td>
                  <td>{shoot.location ?? "—"}</td>
                  <td>
                    {shoot.duration_hours !== null
                      ? `${formatHours(Number(shoot.duration_hours))}h`
                      : "—"}
                  </td>
                  <td>
                    <StatusPill tone={shootStatusTone(shoot.status)}>
                      {shootStatusLabel(shoot.status)}
                    </StatusPill>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <ShootRowActions shoot={shoot} clients={clients} />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
