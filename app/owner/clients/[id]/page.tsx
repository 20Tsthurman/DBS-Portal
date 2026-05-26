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
import { DeactivateClientButton } from "./_components/DeactivateClientButton";
import { EditClientButton } from "./_components/EditClientButton";
import { SendInviteButton } from "./_components/SendInviteButton";
import { OverviewTab } from "./_components/OverviewTab";
import { TabNav, type TabDefinition } from "./_components/TabNav";
import { TimeTab } from "./_components/TimeTab";
import { NotesTab } from "./_components/NotesTab";
import { FilesPanel } from "./_components/FilesPanel";
import { MessageThread } from "@/components/messages/MessageThread";
import { fetchFilesForClient } from "./_lib/queries";
import { InvoicesBoard } from "@/app/owner/invoices/_components/InvoicesBoard";
import {
  fetchClientsForPicker,
  fetchInvoices,
} from "@/app/owner/invoices/_lib/queries";
import { effectiveMonthlyPrice } from "@/lib/pricing";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OwnerClientDetailPage({ params }: PageProps) {
  const { id } = await params;

  const [detail, packages, files, invoices, allClients] = await Promise.all([
    fetchClientDetail(id),
    fetchActivePackages(),
    fetchFilesForClient(id),
    fetchInvoices({ clientId: id }),
    fetchClientsForPicker(),
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
      content: (
        <FilesPanel
          clientId={client.id}
          clientName={client.name}
          files={files}
        />
      ),
    },
    {
      key: "invoices",
      label: "Invoices",
      content: (
        <InvoicesBoard
          invoices={invoices}
          clients={allClients}
          mode="embedded"
          defaultClientId={client.id}
        />
      ),
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

  const effectivePrice = effectiveMonthlyPrice(project, pkg);
  const metaParts = [
    pkg?.name ?? null,
    project?.start_date ? formatDate(project.start_date) : null,
    effectivePrice !== null ? `${formatCurrency(effectivePrice)}/mo` : null,
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

      <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div>
          <h1
            className="page-title !text-[28px] lg:!text-[36px]"
            style={{ marginBottom: 12 }}
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
        <div className="flex items-start gap-2">
          <SendInviteButton
            clientId={client.id}
            clientName={client.name}
            clientType={client.type}
            invitedAt={client.invited_at}
          />
          <DeactivateClientButton
            clientId={client.id}
            clientName={client.name}
            isAlreadyInactive={client.status === "inactive"}
          />
          <EditClientButton
            packages={packages}
            initialValues={{
              id: client.id,
              name: client.name,
              email: client.email,
              type: client.type,
              status: client.status,
              packageId: project?.package_id ?? null,
              invitedAt: client.invited_at,
              monthlyPriceOverride: project?.monthly_price_override ?? null,
              monthlyHoursOverride: project?.monthly_hours_override ?? null,
            }}
          />
        </div>
      </header>

      <TabNav tabs={tabs} initial="overview" />
    </section>
  );
}
