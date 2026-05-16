import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import { fetchActivePackages, fetchClientDetail } from "../_lib/queries";
import {
  clientStatusLabel,
  clientStatusTone,
  formatCurrency,
  formatDate,
} from "../_lib/format";
import { TypePill } from "../_components/TypePill";
import { EditClientButton } from "./_components/EditClientButton";
import { OverviewTab } from "./_components/OverviewTab";
import { TabNav, type TabDefinition } from "./_components/TabNav";
import { TimeTab } from "./_components/TimeTab";
import { NotesTab } from "./_components/NotesTab";
import { MessageThread } from "@/components/messages/MessageThread";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function PlaceholderPanel({ message }: { message: string }) {
  return (
    <div
      className="flex items-center justify-center border px-8 py-20 text-center"
      style={{
        borderColor: "var(--border)",
        backgroundColor: "var(--surface-raised)",
        color: "var(--text-muted)",
        fontSize: 14,
      }}
    >
      {message}
    </div>
  );
}

export default async function OwnerClientDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [detail, packages] = await Promise.all([
    fetchClientDetail(id),
    fetchActivePackages(),
  ]);

  if (!detail) {
    notFound();
  }

  const { client, project, pkg, hoursThisMonth, timeLogs, nextShoot } = detail;

  const recentLogs = timeLogs.slice(0, 5);

  const tabs: TabDefinition[] = [
    {
      key: "overview",
      label: "Overview",
      content: (
        <OverviewTab
          project={project}
          pkg={pkg}
          hoursThisMonth={hoursThisMonth}
          recentLogs={recentLogs}
          nextShoot={nextShoot}
        />
      ),
    },
    {
      key: "time",
      label: "Time",
      content: <TimeTab clientId={client.id} initialLogs={timeLogs} />,
    },
    {
      key: "messages",
      label: "Messages",
      content: (
        <div style={{ height: 600, display: "flex", flexDirection: "column" }}>
          <MessageThread clientId={client.id} viewerRole="owner" />
        </div>
      ),
    },
    {
      key: "files",
      label: "Files",
      content: <PlaceholderPanel message="File management coming soon." />,
    },
    {
      key: "invoices",
      label: "Invoices",
      content: <PlaceholderPanel message="Invoices coming in Phase 4." />,
    },
    {
      key: "notes",
      label: "Notes",
      content: (
        <NotesTab
          clientId={client.id}
          initialNotes={project?.notes ?? ""}
          initialSavedAt={null}
        />
      ),
    },
  ];

  const metaParts = [
    pkg?.name ?? null,
    project?.start_date ? formatDate(project.start_date) : null,
    pkg ? `${formatCurrency(pkg.monthly_price)}/mo` : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <section>
      <div className="mb-3">
        <Link
          href="/owner/clients"
          style={{
            color: "var(--text-muted)",
            fontSize: 12,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          ← All Clients
        </Link>
      </div>

      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <h1
            className="page-title"
            style={{ fontSize: 36, marginBottom: 12 }}
          >
            {client.name}
          </h1>
          <div className="mb-3 flex items-center gap-2">
            <TypePill type={client.type} />
            <StatusPill tone={clientStatusTone(client.status)}>
              {clientStatusLabel(client.status)}
            </StatusPill>
          </div>
          {metaParts.length > 0 && (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 13,
                letterSpacing: "0.02em",
              }}
            >
              {metaParts.join("  |  ")}
            </p>
          )}
        </div>
        <EditClientButton
          packages={packages}
          initialValues={{
            id: client.id,
            name: client.name,
            email: client.email,
            type: client.type,
            status: client.status,
            packageId: project?.package_id ?? null,
          }}
        />
      </header>

      <TabNav tabs={tabs} initial="overview" />
    </section>
  );
}
